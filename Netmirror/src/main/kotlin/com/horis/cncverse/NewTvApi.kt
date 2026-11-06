package com.horis.cncverse

import com.lagradost.api.Log
import com.lagradost.nicehttp.NiceResponse
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.min
import kotlin.random.Random

/**
 * Shared NewTV client.
 *
 * Every provider used to resolve its own cookie/API domain and fire requests
 * independently.  CloudStream loads all providers at once, so that produced
 * bursts of verify.php/checknewtv.php calls and "too many requests" errors.
 *
 * This object keeps a single in-memory + persisted API base, serialises all
 * NewTV requests behind one mutex with a small gap between calls, coalesces
 * duplicate requests through a TTL cache and retries 429/5xx with backoff.
 */
object NewTvApi {
    private const val TAG = "NetMirror"
    private const val MIN_REQUEST_GAP_MS = 300L
    private const val MAX_ATTEMPTS = 4
    private const val BASE_TTL_MS = 12 * 60 * 60 * 1000L

    private val baseMutex = Mutex()
    private val httpMutex = Mutex()
    private var lastRequestAt = 0L

    @Volatile
    private var apiBase: String? = null

    private data class CacheEntry(val body: String, val expiresAt: Long)
    private val cache = ConcurrentHashMap<String, CacheEntry>()

    val newTvBaseHeaders = mapOf(
        "Cache-Control" to "no-cache, no-store, must-revalidate",
        "Pragma" to "no-cache",
        "Expires" to "0",
        "X-Requested-With" to "NetmirrorNewTV v1.0",
        "User-Agent" to
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) " +
            "Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
        "Accept" to "application/json, text/plain, */*"
    )

    private val newTvDomains = listOf(
        "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
        "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
    )

    private fun decodeBase64(value: String): String =
        String(Base64.getDecoder().decode(value))

    fun buildHeaders(ott: String, extra: Map<String, String> = emptyMap()): Map<String, String> {
        val result = newTvBaseHeaders.toMutableMap()
        result["Ott"] = ott
        extra.forEach { (key, value) -> result[key] = value }
        return result
    }

    fun buildPosterUrl(template: String?, id: String): String? {
        if (template.isNullOrBlank()) return null
        return if (template.contains("------------------")) {
            template.replace("------------------", id)
        } else {
            "${template.trimEnd('/')}/$id.jpg"
        }
    }

    suspend fun main(ott: String): NewTvMainResponse = parseJson(
        request(
            path = "main.php",
            ott = ott,
            extraHeaders = mapOf(
                "Page" to "all",
                "Recentplay" to "",
                "Watchlist" to "",
                "Usertoken" to ""
            ),
            ttlMs = 5 * 60_000L
        )
    )

    suspend fun search(ott: String, query: String): NewTvSearchResponse = parseJson(
        request(
            path = "search.php?s=${java.net.URLEncoder.encode(query, "UTF-8")}",
            ott = ott,
            ttlMs = 10 * 60_000L
        )
    )

    suspend fun post(ott: String, id: String): NewTvDetail = parseJson(
        request(
            path = "post.php?id=$id",
            ott = ott,
            extraHeaders = mapOf("Lastep" to "", "Usertoken" to ""),
            ttlMs = 15 * 60_000L
        )
    )

    suspend fun episodes(ott: String, seasonId: String, page: Int): NewTvEpisodesResponse =
        parseJson(
            request(
                path = "episodes.php?id=$seasonId&page=$page",
                ott = ott,
                ttlMs = 30 * 60_000L
            )
        )

    suspend fun player(ott: String, id: String): NewTvPlayerResponse = parseJson(
        request(
            path = "player.php?id=$id",
            ott = ott,
            extraHeaders = mapOf("Usertoken" to ""),
            ttlMs = 60_000L
        )
    )

    private suspend fun request(
        path: String,
        ott: String,
        extraHeaders: Map<String, String> = emptyMap(),
        ttlMs: Long = 60_000L,
        force: Boolean = false
    ): String {
        val cacheKey = "$ott|$path"
        if (!force) {
            cache[cacheKey]?.let { entry ->
                if (entry.expiresAt > System.currentTimeMillis()) return entry.body
            }
        }

        var lastError: Exception? = null
        var attempts = 0
        while (attempts < MAX_ATTEMPTS) {
            attempts++
            val base = baseUrl(force = attempts > 1 && lastError is RateLimitException)
            val url = "$base/newtv/$path"
            try {
                val response = execute(url, buildHeaders(ott, extraHeaders))
                val body = response.text
                if (response.code in 200..299 && body.isNotBlank()) {
                    if (isRateLimited(body)) throw RateLimitException(body)
                    cache[cacheKey] = CacheEntry(body, System.currentTimeMillis() + ttlMs)
                    return body
                }
                if (response.code == 403) {
                    invalidateBase()
                    throw RateLimitException("HTTP 403")
                }
                if (response.code == 429 || response.code >= 500) {
                    throw RateLimitException("HTTP ${response.code}")
                }
                throw Exception("HTTP ${response.code}: ${body.take(200)}")
            } catch (e: Exception) {
                lastError = e
                Log.e(TAG, "NewTV request failed (attempt $attempts/$MAX_ATTEMPTS) $url: ${e.message}")
                if (attempts >= MAX_ATTEMPTS) break
                val backoff = min(8_000L, 700L * (1L shl (attempts - 1)))
                delay(backoff + Random.nextLong(0, 400))
            }
        }
        throw lastError ?: Exception("NewTV request failed: $path")
    }

    private suspend fun execute(url: String, headers: Map<String, String>): NiceResponse {
        return httpMutex.withLock {
            val now = System.currentTimeMillis()
            val wait = MIN_REQUEST_GAP_MS - (now - lastRequestAt)
            if (wait > 0) delay(wait)
            try {
                app.get(url, headers = headers)
            } finally {
                lastRequestAt = System.currentTimeMillis()
            }
        }
    }

    private suspend fun rawGet(url: String, headers: Map<String, String>): NiceResponse {
        var lastError: Exception? = null
        for (attempt in 1..MAX_ATTEMPTS) {
            try {
                val response = execute(url, headers)
                if (response.code in 200..299) return response
                if (response.code == 429 || response.code >= 500) {
                    throw RateLimitException("HTTP ${response.code}")
                }
                throw Exception("HTTP ${response.code}")
            } catch (e: Exception) {
                lastError = e
                if (attempt >= MAX_ATTEMPTS) break
                delay(min(5_000L, 500L * (1L shl (attempt - 1))) + Random.nextLong(0, 300))
            }
        }
        throw lastError ?: Exception("Request failed: $url")
    }

    private suspend fun baseUrl(force: Boolean = false): String {
        if (!force) {
            apiBase?.let { return it }
            val (stored, timestamp) = NetflixMirrorStorage.getApiBase()
            if (!stored.isNullOrBlank() && System.currentTimeMillis() - timestamp < BASE_TTL_MS) {
                apiBase = stored
                return stored
            }
        }

        return baseMutex.withLock {
            apiBase?.takeIf { !force }?.let { return@withLock it }

            var lastError: Exception? = null
            for (encoded in newTvDomains) {
                val base = decodeBase64(encoded).trimEnd('/')
                try {
                    val response = rawGet("$base/checknewtv.php", newTvBaseHeaders)
                    val token = tryParseJson<NewTvTokenResponse>(response.text)
                    val resolved = token?.token_hash?.let { decodeBase64(it) }?.trimEnd('/')
                    if (!resolved.isNullOrBlank() && resolved.startsWith("http")) {
                        apiBase = resolved
                        NetflixMirrorStorage.saveApiBase(resolved)
                        Log.d(TAG, "Resolved NewTV API base: $resolved")
                        return@withLock resolved
                    }
                } catch (e: Exception) {
                    lastError = e
                }
            }
            throw Exception("Failed to resolve NewTV API base", lastError)
        }
    }

    private fun invalidateBase() {
        apiBase = null
        NetflixMirrorStorage.clearApiBase()
    }

    private fun isRateLimited(body: String): Boolean {
        val lower = body.lowercase()
        return "too many request" in lower || "rate limit" in lower || "slow down" in lower
    }

    private class RateLimitException(message: String) : Exception(message)

    // --- Models -------------------------------------------------------------

    data class NewTvTokenResponse(val token_hash: String? = null)

    data class NewTvMainResponse(
        val post: List<NewTvCategory>? = null,
        val imgcdn_h: String? = null,
        val imgcdn_v: String? = null,
        val img_referer: String? = null,
        val status: String? = null
    )

    data class NewTvCategory(
        val ids: String? = null,
        val cate: String? = null,
        val row: String? = null
    )

    data class NewTvSearchResponse(
        val searchResult: List<NewTvSearchItem>? = null,
        val detailsimgcdn: String? = null,
        val imgcdn: String? = null,
        val img_referer: String? = null
    )

    data class NewTvSearchItem(
        val id: String = "",
        val t: String = ""
    )

    data class NewTvDetail(
        val status: String? = null,
        val title: String? = null,
        val main_id: String? = null,
        val desc: String? = null,
        val year: String? = null,
        val runtime: String? = null,
        val type: String? = null,
        val ua: String? = null,
        val main_poster: String? = null,
        val ep_poster: String? = null,
        val morelike_poster: String? = null,
        val img_referer: String? = null,
        val moredetails: List<NewTvDetailPair>? = null,
        val episodes: List<NewTvEpisode?>? = null,
        val season: List<NewTvSeason>? = null,
        val nextPageSeason: String? = null,
        val nextPageShow: Int? = null,
        val suggest: List<NewTvSuggest>? = null
    ) {
        fun value(vararg keys: String): String? = moredetails
            ?.firstOrNull { pair -> keys.any { pair.k.equals(it, ignoreCase = true) } }
            ?.v

        val cast: String? get() = value("Cast")
        val rating: String? get() = value("IMDB Rating")
        val genre: String? get() = value(
            "IMDB Genres", "Genres", "Netflix Genres", "HotStar Genres",
            "Prime Video Genres", "PrimeVideo Genres"
        )
        val director: String? get() = value("Director", "Creator")
    }

    data class NewTvDetailPair(
        val k: String = "",
        val v: String = ""
    )

    data class NewTvSeason(
        val id: String = "",
        val s: String = "",
        val selected: Boolean = false
    )

    data class NewTvSuggest(val id: String = "")

    data class NewTvEpisodesResponse(
        val episodes: List<NewTvEpisode>? = null,
        val nextPageShow: Int? = null,
        val nextPageSeason: String? = null
    )

    data class NewTvEpisode(
        val id: String = "",
        val ep: String = "",
        val s: String = "",
        val t: String = "",
        val info: List<String>? = null
    ) {
        val runtimeMinutes: Int?
            get() = info?.firstOrNull { it.endsWith("m") }
                ?.removeSuffix("m")
                ?.trim()
                ?.toIntOrNull()

        val episodeNumber: Int?
            get() = ep.replace("E", "").trim().toIntOrNull()

        val seasonNumber: Int?
            get() = s.replace("S", "").trim().toIntOrNull()
    }

    data class NewTvPlayerResponse(
        val status: String? = null,
        val video_link: String? = null,
        val referer: String? = null
    )
}

data class NewTvId(val id: String)

data class NewTvLoadData(val title: String, val id: String)
