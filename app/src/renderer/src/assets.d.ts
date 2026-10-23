// Files Vite copies into the build: importing one gives its URL.
declare module '*.mp4' {
  const url: string
  export default url
}
declare module '*.mp3' {
  const url: string
  export default url
}
declare module '*.jpg' {
  const url: string
  export default url
}
