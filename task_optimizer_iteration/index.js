const paths = require('./paths')
const algorithm = require('./algorithm')
const evaluate = require('./evaluate')
const bootstrap = require('./bootstrap')
const overfitting = require('./overfitting')
const run = require('./run')

module.exports = {
  ...paths,
  ...algorithm,
  ...evaluate,
  ...bootstrap,
  ...overfitting,
  run
}
