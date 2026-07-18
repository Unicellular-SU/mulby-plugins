export interface InBrowserOptions {
    show?: boolean;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    center?: boolean;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    resizable?: boolean;
    movable?: boolean;
    minimizable?: boolean;
    maximizable?: boolean;
    alwaysOnTop?: boolean;
    fullscreen?: boolean;
    fullscreenable?: boolean;
    enableLargerThanScreen?: boolean;
    opacity?: number;
    frame?: boolean;
    closable?: boolean;
    focusable?: boolean;
    skipTaskbar?: boolean;
    backgroundColor?: string;
    hasShadow?: boolean;
    transparent?: boolean;
    titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover';
    thickFrame?: boolean;
    webPreferences?: Electron.WebPreferences;
}

export interface InBrowserInstance {
    id: number;
    url: string;
    title: string;
    width: number;
    height: number;
    x: number;
    y: number;
}

export interface CookieFilter {
    url?: string;
    name?: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    session?: boolean;
    httpOnly?: boolean;
}

type InBrowserFunction = (...params: unknown[]) => unknown;

export interface InBrowserOp {
    type: 'goto' | 'show' | 'hide' | 'viewport' | 'click' | 'type' | 'press' | 'evaluate' | 'wait' | 'css' | 'when' | 'cookies' | 'pdf' | 'value' | 'check' | 'scroll' | 'devTools' | 'useragent' | 'focus' | 'end' | 'paste' | 'file' | 'device' | 'mousedown' | 'mouseup' | 'input' | 'clearCookies' | 'dblclick' | 'hover' | 'screenshot' | 'markdown' | 'setCookies' | 'removeCookies' | 'download' | 'drop';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[];
}

export interface InBrowserRunPayload {
    id?: number;
    options?: InBrowserOptions;
    queue: InBrowserOp[];
}

// Result tuple: [...any, InBrowserInstance]
// We can't easily express variadic tuple types this way universally without strict TS versions,
// but the promise return type is usually just Promise<any[]> where the last item is known.

export interface InBrowser {
    goto(url: string, headers?: Record<string, string>, timeout?: number): InBrowser;
    useragent(ua: string): InBrowser;
    viewport(width: number, height: number): InBrowser;
    hide(): InBrowser;
    show(): InBrowser;
    css(css: string): InBrowser;
    evaluate(func: string | InBrowserFunction, ...params: unknown[]): InBrowser;
    press(key: string, modifiers?: string[]): InBrowser;
    click(selector: string, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    click(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    mousedown(selector: string, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    mousedown(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    mouseup(selector: string, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    mouseup(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    dblclick(selector: string, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    dblclick(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): InBrowser;
    hover(selector: string): InBrowser;
    hover(x: number, y: number): InBrowser;
    file(selector: string, payload: string | string[] | Buffer): InBrowser;
    drop(selector: string, payload: string | string[] | Buffer): InBrowser;
    drop(x: number, y: number, payload: string | string[] | Buffer): InBrowser;
    input(text: string): InBrowser;
    input(selector: string, text: string): InBrowser;
    value(selector: string, val: string): InBrowser;
    check(selector: string, checked: boolean): InBrowser;
    focus(selector: string): InBrowser;
    scroll(selector: string, optional?: boolean | { behavior?: 'auto' | 'smooth'; block?: 'start' | 'center' | 'end' | 'nearest'; inline?: 'start' | 'center' | 'end' | 'nearest'; }): InBrowser;
    scroll(y: number): InBrowser;
    scroll(x: number, y: number): InBrowser;
    download(urlOrFunc: string | InBrowserFunction, savePath?: string | null, ...params: unknown[]): InBrowser;
    paste(text: string): InBrowser;
    screenshot(target?: string | { x: number; y: number; width: number; height: number }, savePath?: string): InBrowser;
    markdown(selector?: string): InBrowser;
    pdf(options?: Electron.PrintToPDFOptions, savePath?: string): InBrowser;
    device(options: { userAgent: string; size: { width: number; height: number } }): InBrowser;
    wait(ms: number): InBrowser;
    wait(selector: string, result?: boolean): InBrowser;
    wait(selector: string, timeout?: number): InBrowser;
    wait(selector: string, option?: { timeout?: number, interval?: number, result?: boolean }): InBrowser;
    wait(func: InBrowserFunction, ...params: unknown[]): InBrowser;
    when(selector: string, result?: boolean): InBrowser;
    when(func: string | InBrowserFunction, ...params: unknown[]): InBrowser;
    end(): InBrowser;
    devTools(mode?: 'right' | 'bottom' | 'undocked' | 'detach'): InBrowser;
    cookies(name?: string): InBrowser;
    cookies(filter: CookieFilter): InBrowser;
    // cookies(filter...)
    setCookies(name: string, value: string): InBrowser;
    setCookies(cookies: { name: string; value: string }[]): InBrowser;
    removeCookies(name: string): InBrowser;
    clearCookies(url?: string): InBrowser;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run(ubrowserId?: number, options?: InBrowserOptions): Promise<any[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run(options?: InBrowserOptions): Promise<any[]>;
}
