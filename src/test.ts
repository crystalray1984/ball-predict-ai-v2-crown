import { processFinalCheck } from './start-final-check'

const data = {
    crown_match_id: '9493076',
    extra: { match_id: 5283, promoted_odd_attrs: [] },
    data: {
        match: {
            match_time: 0,
            league: '巴西杯',
            lid: '100798',
            team_c: '卡尔拉CE',
            team_h: '彭美拉斯SP',
            team_id_c: '127920',
            team_id_h: '103895',
        },
        odds: [
            { variety: 'goal', type: 'r', condition: '-1', value_h: '1.87', value_c: '2.03' },
            { variety: 'goal', type: 'hr', condition: '-0.5', value_h: '2.12', value_c: '1.79' },
            { variety: 'goal', type: 'ou', condition: '2.25', value_h: '1.96', value_c: '1.92' },
            { variety: 'goal', type: 'hou', condition: '1', value_h: '1.77', value_c: '2.12' },
            { variety: 'goal', type: 'r', condition: '-1.25', value_h: '2.23', value_c: '1.71' },
            { variety: 'goal', type: 'hr', condition: '-0.25', value_h: '1.68', value_c: '2.28' },
            { variety: 'goal', type: 'ou', condition: '2.5', value_h: '1.74', value_c: '2.16' },
            { variety: 'goal', type: 'hou', condition: '0.75', value_h: '2.25', value_c: '1.68' },
        ],
    },
}

processFinalCheck(data as any)
