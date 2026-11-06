package com.horis.cncverse

import com.lagradost.cloudstream3.USER_AGENT
import com.lagradost.nicehttp.Requests
import com.lagradost.nicehttp.ResponseParser
import com.lagradost.api.Log
import com.fasterxml.jackson.core.json.JsonReadFeature
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.cncverse.BuildConfig
import kotlin.reflect.KClass

val JSONParser = object : ResponseParser {
    val mapper: ObjectMapper = jacksonObjectMapper().configure(
        DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false
    ).configure(
        JsonReadFeature.ALLOW_UNESCAPED_CONTROL_CHARS.mappedFeature(), true
    )

    override fun <T : Any> parse(text: String, kClass: KClass<T>): T {
        return mapper.readValue(text, kClass.java)
    }

    override fun <T : Any> parseSafe(text: String, kClass: KClass<T>): T? {
        return try {
            mapper.readValue(text, kClass.java)
        } catch (e: Exception) {
            null
        }
    }

    override fun writeValueAsString(obj: Any): String {
        return mapper.writeValueAsString(obj)
    }
}

val app = Requests(responseParser = JSONParser).apply {
    defaultHeaders = mapOf("User-Agent" to USER_AGENT)
}

inline fun <reified T : Any> parseJson(text: String): T {
    return JSONParser.parse(text, T::class)
}

inline fun <reified T : Any> tryParseJson(text: String): T? {
    return try {
        JSONParser.parseSafe(text, T::class)
    } catch (e: Exception) {
        e.printStackTrace()
        null
    }
}

fun convertRuntimeToMinutes(runtime: String): Int {
    var totalMinutes = 0
    val parts = runtime.split(" ")
    for (part in parts) {
        when {
            part.endsWith("h") -> {
                val hours = part.removeSuffix("h").trim().toIntOrNull() ?: 0
                totalMinutes += hours * 60
            }
            part.endsWith("m") -> {
                val minutes = part.removeSuffix("m").trim().toIntOrNull() ?: 0
                totalMinutes += minutes
            }
        }
    }
    return totalMinutes
}

private val TMDB_READ_TOKEN = BuildConfig.TMDB_READ_TOKEN
private val tmdbIdCache = mutableMapOf<String, String?>()

suspend fun resolveTmdbId(title: String, year: String?, isMovie: Boolean): String? {
    val cacheKey = "$title|$year|$isMovie"
    if (tmdbIdCache.containsKey(cacheKey)) return tmdbIdCache[cacheKey]

    val mediaType = if (isMovie) "movie" else "tv"
    val result = try {
        val url = "https://api.themoviedb.org/3/search/$mediaType" +
            "?query=${java.net.URLEncoder.encode(title, "UTF-8")}"
        val rawText = app.get(
            url,
            headers = mapOf(
                "Authorization" to "Bearer $TMDB_READ_TOKEN",
                "Accept" to "application/json"
            )
        ).text
        val parsed = tryParseJson<TmdbSearchResponse>(rawText)
        when {
            parsed == null -> {
                Log.e("NetflixMirror", "TMDB response unparseable for title='$title': $rawText")
                null
            }
            parsed.success == false -> {
                Log.e("NetflixMirror", "TMDB API error for title='$title': ${parsed.status_message}")
                null
            }
            else -> {
                val candidates = parsed.results.orEmpty()
                if (candidates.isEmpty()) {
                    Log.e("NetflixMirror", "TMDB found zero results for title='$title' type='$mediaType'")
                    null
                } else {
                    val match = candidates.firstOrNull { candidate ->
                        val dateStr = if (isMovie) candidate.release_date else candidate.first_air_date
                        !year.isNullOrBlank() && dateStr?.take(4) == year
                    } ?: candidates.first()
                    match.id?.toString()
                }
            }
        }
    } catch (e: Exception) {
        Log.e("NetflixMirror", "TMDB lookup threw for title='$title': ${e.message}")
        null
    }

    tmdbIdCache[cacheKey] = result
    return result
}

data class TmdbSearchResponse(
    val results: List<TmdbSearchResult>? = null,
    val success: Boolean? = null,
    val status_message: String? = null
)

data class TmdbSearchResult(
    val id: Int? = null,
    val release_date: String? = null,
    val first_air_date: String? = null
)
