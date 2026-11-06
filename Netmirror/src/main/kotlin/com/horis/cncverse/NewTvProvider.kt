package com.horis.cncverse

import com.lagradost.cloudstream3.Actor
import com.lagradost.cloudstream3.ActorData
import com.lagradost.cloudstream3.Episode
import com.lagradost.cloudstream3.HomePageList
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.LoadResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MainPageRequest
import com.lagradost.cloudstream3.Score
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.newAnimeSearchResponse
import com.lagradost.cloudstream3.newEpisode
import com.lagradost.cloudstream3.newHomePageResponse
import com.lagradost.cloudstream3.newMovieLoadResponse
import com.lagradost.cloudstream3.newTvSeriesLoadResponse
import com.lagradost.cloudstream3.utils.AppUtils.toJson
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink

/**
 * One implementation of the NewTV flow shared by every OTT provider.
 * Subclasses only provide the OTT code and display metadata.
 */
abstract class NewTvProvider : MainAPI() {
    protected abstract val ott: String

    override var mainUrl = "https://net52.cc"
    override var lang = "hi"
    override val hasMainPage = true

    override suspend fun getMainPage(page: Int, request: MainPageRequest): HomePageResponse? {
        val response = NewTvApi.main(ott)
        val referer = response.img_referer ?: mainUrl
        val items = response.post.orEmpty().map { category ->
            val ids = category.ids.orEmpty()
                .split(",")
                .map(String::trim)
                .filter(String::isNotEmpty)
            val horizontal = category.row == "h"
            val template = if (horizontal) {
                response.imgcdn_h ?: response.imgcdn_v
            } else {
                response.imgcdn_v ?: response.imgcdn_h
            }
            val results = ids.map { id ->
                newAnimeSearchResponse("", NewTvId(id).toJson()) {
                    posterUrl = NewTvApi.buildPosterUrl(template, id)
                    posterHeaders = mapOf("Referer" to referer)
                }
            }
            HomePageList(category.cate.orEmpty(), results, isHorizontalImages = horizontal)
        }
        return newHomePageResponse(items, hasNext = items.isNotEmpty())
    }

    override suspend fun search(query: String): List<SearchResponse> {
        val data = NewTvApi.search(ott, query)
        val referer = data.img_referer ?: mainUrl
        val template = data.detailsimgcdn ?: data.imgcdn
        return data.searchResult.orEmpty().map { item ->
            newAnimeSearchResponse(item.t, NewTvId(item.id).toJson()) {
                posterUrl = NewTvApi.buildPosterUrl(template, item.id)
                posterHeaders = mapOf("Referer" to referer)
            }
        }
    }

    override suspend fun load(url: String): LoadResponse? {
        val id = parseJson<NewTvId>(url).id
        val data = NewTvApi.post(ott, id)
        val title = data.title ?: id
        val referer = data.img_referer ?: mainUrl
        val playbackId = data.main_id ?: id
        val cast = data.cast.orEmpty()
            .split(",")
            .map(String::trim)
            .filter(String::isNotEmpty)
            .map { ActorData(Actor(it)) }
        val genre = data.genre?.split(",")
            ?.map(String::trim)
            ?.filter(String::isNotEmpty)
        val rating = data.rating?.replace("IMDb ", "")
        val duration = convertRuntimeToMinutes(data.runtime.orEmpty())
        val recommendations = data.suggest.orEmpty().map {
            newAnimeSearchResponse("", NewTvId(it.id).toJson()) {
                posterUrl = NewTvApi.buildPosterUrl(data.morelike_poster, it.id)
                posterHeaders = mapOf("Referer" to referer)
            }
        }
        val isSeries = data.type == "t" || data.episodes?.any { it != null } == true

        if (!isSeries) {
            return newMovieLoadResponse(
                title, url, TvType.Movie, NewTvLoadData(title, playbackId).toJson()
            ) {
                posterUrl = NewTvApi.buildPosterUrl(data.main_poster, id)
                backgroundPosterUrl = NewTvApi.buildPosterUrl(data.main_poster, id)
                posterHeaders = mapOf("Referer" to referer)
                plot = data.desc
                year = data.year?.toIntOrNull()
                tags = genre
                actors = cast
                score = Score.from10(rating)
                this.duration = duration
                this.recommendations = recommendations
                contentRating = data.ua
            }
        }

        val episodes = arrayListOf<Episode>()
        val seasons = data.season.orEmpty()
        val selectedIndex = seasons.indexOfFirst { it.selected }.takeIf { it >= 0 }
            ?: seasons.indices.firstOrNull()
        val selectedSeason = selectedIndex?.let { seasons.getOrNull(it) }
        val selectedNumber = selectedIndex?.plus(1)

        data.episodes.orEmpty().filterNotNull().mapTo(episodes) {
            newEpisode(NewTvLoadData(title, it.id)) {
                name = it.t
                episode = it.episodeNumber
                season = it.seasonNumber ?: selectedNumber
                posterUrl = NewTvApi.buildPosterUrl(data.ep_poster, it.id)
                runTime = it.runtimeMinutes
            }
        }

        if (selectedSeason != null) {
            if (data.episodes.isNullOrEmpty()) {
                episodes.addAll(getEpisodes(selectedSeason.id, 1, selectedNumber, data.ep_poster))
            }
            if (data.nextPageShow == 1) {
                episodes.addAll(getEpisodes(selectedSeason.id, 2, selectedNumber, data.ep_poster))
            }
            seasons.forEachIndexed { index, season ->
                if (season.id != selectedSeason.id && season.id.isNotBlank()) {
                    episodes.addAll(getEpisodes(season.id, 1, index + 1, data.ep_poster))
                }
            }
        }

        if (episodes.isEmpty()) {
            episodes.add(newEpisode(NewTvLoadData(title, playbackId)) { name = title })
        }

        return newTvSeriesLoadResponse(title, url, TvType.TvSeries, episodes) {
            posterUrl = NewTvApi.buildPosterUrl(data.main_poster, id)
            backgroundPosterUrl = NewTvApi.buildPosterUrl(data.main_poster, id)
            posterHeaders = mapOf("Referer" to referer)
            plot = data.desc
            year = data.year?.toIntOrNull()
            tags = genre
            actors = cast
            score = Score.from10(rating)
            this.duration = duration
            this.recommendations = recommendations
            contentRating = data.ua
        }
    }

    private suspend fun getEpisodes(
        seasonId: String,
        page: Int,
        seasonNumber: Int?,
        posterTemplate: String?
    ): List<Episode> {
        val episodes = arrayListOf<Episode>()
        var currentPage = page
        var guard = 0
        while (guard++ < 50) {
            val data = NewTvApi.episodes(ott, seasonId, currentPage)
            data.episodes.orEmpty().mapTo(episodes) {
                newEpisode(NewTvLoadData("", it.id)) {
                    name = it.t
                    episode = it.episodeNumber
                    season = it.seasonNumber ?: seasonNumber
                    posterUrl = NewTvApi.buildPosterUrl(posterTemplate, it.id)
                    runTime = it.runtimeMinutes
                }
            }
            if (data.nextPageShow != 1) break
            currentPage++
        }
        return episodes
    }

    override suspend fun loadLinks(
        data: String,
        isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit
    ): Boolean {
        val id = parseJson<NewTvLoadData>(data).id
        val response = NewTvApi.player(ott, id)
        val link = response.link
        if (link.isNullOrBlank()) return false
        val type = if (link.contains(".mp4")) ExtractorLinkType.VIDEO else ExtractorLinkType.M3U8
        callback(
            newExtractorLink(name, name, link, type = type) {
                referer = response.referer ?: mainUrl
            }
        )
        return true
    }
}
