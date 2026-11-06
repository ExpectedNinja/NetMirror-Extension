package com.horis.cncverse

import android.content.Context
import android.content.SharedPreferences

object NetflixMirrorStorage {
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext
            .getSharedPreferences("NetflixMirrorPrefs", Context.MODE_PRIVATE)
    }

    private fun prefs(): SharedPreferences? = prefs

    fun saveCookie(cookie: String) {
        prefs()?.edit()
            ?.putString("nf_cookie", cookie)
            ?.putLong("nf_cookie_timestamp", System.currentTimeMillis())
            ?.apply()
    }

    fun getCookie(): Pair<String?, Long> {
        val p = prefs() ?: return Pair(null, 0L)
        return Pair(
            p.getString("nf_cookie", null),
            p.getLong("nf_cookie_timestamp", 0L)
        )
    }

    fun clearCookie() {
        prefs()?.edit()
            ?.remove("nf_cookie")
            ?.remove("nf_cookie_timestamp")
            ?.apply()
    }

    fun saveApiBase(baseUrl: String) {
        prefs()?.edit()
            ?.putString("newtv_api_base", baseUrl)
            ?.putLong("newtv_api_base_timestamp", System.currentTimeMillis())
            ?.apply()
    }

    fun getApiBase(): Pair<String?, Long> {
        val p = prefs() ?: return Pair(null, 0L)
        return Pair(
            p.getString("newtv_api_base", null),
            p.getLong("newtv_api_base_timestamp", 0L)
        )
    }

    fun clearApiBase() {
        prefs()?.edit()
            ?.remove("newtv_api_base")
            ?.remove("newtv_api_base_timestamp")
            ?.apply()
    }
}
