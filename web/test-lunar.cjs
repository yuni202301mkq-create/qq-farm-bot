const solarlunar = require('solarlunar').default
const r = solarlunar.solar2lunar(2026, 9, 18)
console.log(JSON.stringify({ monthCn: r.monthCn, dayCn: r.dayCn, term: r.term, animal: r.animal }))
const r2 = solarlunar.solar2lunar(2026, 2, 17)
console.log(JSON.stringify({ monthCn: r2.monthCn, dayCn: r2.dayCn }))
const r3 = solarlunar.solar2lunar(2026, 9, 17)
console.log(JSON.stringify({ monthCn: r3.monthCn, dayCn: r3.dayCn }))
