import Decimal from 'decimal.js'

console.log(Decimal('1.25').mul(100).sub(Decimal('1.25').mul(100)).div(25).abs().toNumber())
