/** SVGR config — `npm run icons` ile src/assets/svg → src/components/icons */
module.exports = {
  typescript: true,
  icon: true,
  jsxRuntime: "automatic",
  expandProps: "end",
  memo: false,
  prettier: false,
  svgoConfig: {
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            removeViewBox: false,
          },
        },
      },
      {
        name: "convertColors",
        params: { currentColor: true },
      },
    ],
  },
};
