package com.horis.cncverse

import com.lagradost.cloudstream3.TvType

class NetflixMirrorProvider : NewTvProvider() {
    override val ott = "nf"
    override var name = "Netflix"
    override val supportedTypes = setOf(TvType.Movie, TvType.TvSeries)
}
