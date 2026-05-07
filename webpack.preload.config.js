const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/preload.ts',
  target: 'electron-preload',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'preload.js',
  },
};
