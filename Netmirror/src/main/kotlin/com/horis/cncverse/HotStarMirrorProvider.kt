package com.horis.cncverse

import com.lagradost.cloudstream3.TvType

class HotStarMirrorProvider : NewTvProvider() {
    override val ott = "hs"
    override var name = "Hotstar"
    override val supportedTypes = setOf(
        TvType.Movie,
        TvType.TvSeries,
        TvType.Anime,
        TvType.AsianDrama
    )
}
