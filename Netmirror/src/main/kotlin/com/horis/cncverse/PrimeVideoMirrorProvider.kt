package com.horis.cncverse

import com.lagradost.cloudstream3.TvType

class PrimeVideoMirrorProvider : NewTvProvider() {
    override val ott = "pv"
    override var name = "Prime Video"
    override val supportedTypes = setOf(
        TvType.Movie,
        TvType.TvSeries,
        TvType.Anime,
        TvType.AsianDrama
    )
}
