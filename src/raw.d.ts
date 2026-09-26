// Files imported with `?raw` arrive as their text (see webpack.config.js).
declare module '*?raw' {
  const text: string;
  export default text;
}
