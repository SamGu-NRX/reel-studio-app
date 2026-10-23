/** Height of the title-bar row in px: T3 Code's numbers (apps/desktop/src/window/DesktopWindow.ts), 52 under the macOS
 * window buttons, 40 for the Windows caption buttons. Main places the buttons on it; the renderer lays the row out with it. */
export const titlebarHeight = (platform: string): number => (platform === 'darwin' ? 52 : 40)
