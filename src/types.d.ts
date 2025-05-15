declare namespace Crown {
    /**
     * 由皇冠返回的比赛数据
     */
    interface MatchInfo {
        /**
         * 比赛时间
         */
        match_time: number
        /**
         * 皇冠比赛id
         */
        ecid: string
        /**
         * 赛事名称
         */
        league: string
        /**
         * 皇冠赛事id
         */
        lid: string
        /**
         * 主队名称
         */
        team_h: string
        /**
         * 客队名称
         */
        team_c: string
        /**
         * 主队id
         */
        team_id_h: string
        /**
         * 客队id
         */
        team_id_c: string
    }

    /**
     * 皇冠返回的单个盘口数据
     */
    interface Game extends MatchInfo {
        /**
         * 盘口类型 0-赛果 146-角球
         */
        ptype_id: string
        /**
         * 让球方
         */
        strong: 'H' | 'C'
        /**
         * 全场让球是否开启
         */
        sw_R: 'Y' | 'N'
        /**
         * 全场让球数
         */
        ratio: string
        /**
         * 主队让球赔率
         */
        ior_RH: string
        /**
         * 客队让球赔率
         */
        ior_RC: string
        /**
         * 上半场让球方
         */
        hstrong: 'H' | 'C'
        /**
         * 上半场让球是否开启
         */
        sw_HR: 'Y' | 'N'
        /**
         * 上半场让球数
         */
        hratio: string
        /**
         * 上半场主队让球赔率
         */
        ior_HRH: string
        /**
         * 上半场客队让球赔率
         */
        ior_HRC: string
        /**
         * 全场大小球是否开启
         */
        sw_OU: 'Y' | 'N'
        /**
         * 全场大小球临界点
         */
        ratio_o: string
        /**
         * 全场小球赔率
         */
        ior_OUH: string
        /**
         * 全场大球赔率
         */
        ior_OUC: string
        /**
         * 上半场大小球是否开启
         */
        sw_HOU: 'Y' | 'N'
        /**
         * 上半场大小球临界点
         */
        ratio_ho: string
        /**
         * 上半场小球赔率
         */
        ior_HOUH: string
        /**
         * 上半场大球赔率
         */
        ior_HOUC: string
    }

    /**
     * 皇冠接口返回的数据
     */
    interface Resp {
        /**
         * 盘口数据
         */
        game: Game[]
    }

    interface OddInfo {
        variety: 'goal' | 'corner'

        type: 'r' | 'hr' | 'ou' | 'hou'

        condition: string

        value_h: string

        value_c: string
    }

    interface OddData {
        match: MatchInfo
        odds: OddInfo[]
    }
}

/**
 * 来自消息队列的数据
 */
declare interface CrownQueueInputData {
    /**
     * 消息处理完之后应抛到的下一个队列
     */
    next: string
    /**
     * 待获取的皇冠比赛id
     */
    crown_match_id: string
    /**
     * 透传参数
     */
    extra?: any
}
