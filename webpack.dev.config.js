const webpack = require('webpack');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {

  // Set the mode to development or production
  mode: 'development',

  // Control how source maps are generated
  devtool: 'inline-source-map',

  module: {
    rules: [
      // Styles: Inject CSS into the head with source maps
      {
        test: /\.(scss|css)$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: { 
              sourceMap: true, 
              importLoaders: 1, 
              modules: {
                // https://github.com/webpack-contrib/css-loader#separating-interoperable-css-only-and-css-module-features
                // allow Interoperable CSS features only (such as :import and :export) without using further CSS Module functionality
                compileType: 'icss'
              } 
            },
          },
          { loader: 'postcss-loader', options: { sourceMap: true } }, // see postcss.config.js for options
          { loader: 'sass-loader', options: { sourceMap: true } },
        ],
      },
    ],
  },
});