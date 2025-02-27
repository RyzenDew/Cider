import {app, Menu, nativeImage, Tray} from 'electron';
import * as path from 'path';
import {utils} from './utils'

export class AppEvents {
    private protocols: string[] = [
        "ame",
        "cider",
        "itms",
        "itmss",
        "musics",
        "music"
    ]
    private plugin: any = undefined;
    private tray: any = undefined;
    private i18n: any = undefined;

    constructor() {
        this.start();
    }

    /**
     * Handles all actions that occur for the app on start (Mainly commandline arguments)
     * @returns {void}
     */
    private start(): void {
        console.info('[AppEvents] App started');

        /**********************************************************************************************************************
         * Startup arguments handling
         **********************************************************************************************************************/
        if (app.commandLine.hasSwitch('version') || app.commandLine.hasSwitch('v')) {
            console.log(app.getVersion())
            app.exit()
        }

        // Verbose Check
        if (app.commandLine.hasSwitch('verbose')) {
            console.log("[Cider] User has launched the application with --verbose");
        }

        // Log File Location
        if (app.commandLine.hasSwitch('log') || app.commandLine.hasSwitch('l')) {
            console.log(path.join(app.getPath('userData'), 'logs'))
            app.exit()
        }

        // Expose GC
        app.commandLine.appendSwitch('js-flags', '--expose_gc')

        if (process.platform === "win32") {
            app.setAppUserModelId(app.getName()) // For notification name
        }

        /***********************************************************************************************************************
         * Commandline arguments
         **********************************************************************************************************************/
        switch (utils.getStoreValue('visual.hw_acceleration') as string) {
            default:
            case "default":
                app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode')
                app.commandLine.appendSwitch('enable-accelerated-video')
                app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds')
                app.commandLine.appendSwitch('ignore-gpu-blacklist')
                app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
                app.commandLine.appendSwitch('enable-accelerated-video-decode');
                app.commandLine.appendSwitch('enable-gpu-rasterization');
                app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
                app.commandLine.appendSwitch('enable-oop-rasterization');
                break;

            case "webgpu":
                console.info("WebGPU is enabled.");
                app.commandLine.appendSwitch('enable-unsafe-webgpu')
                break;

            case "disabled":
                console.info("Hardware acceleration is disabled.");
                app.commandLine.appendSwitch('disable-gpu')
                break;
        }

        if (process.platform === "linux") {
            app.commandLine.appendSwitch('disable-features', 'MediaSessionService');
        }

        /***********************************************************************************************************************
         * Protocols
         **********************************************************************************************************************/
        if (process.defaultApp) {
            if (process.argv.length >= 2) {
                this.protocols.forEach((protocol: string) => {
                    app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
                })
            }
        } else {
            this.protocols.forEach((protocol: string) => {
                app.setAsDefaultProtocolClient(protocol)
            })
        }


    }

    public quit() {
        console.log('[AppEvents] App quit');
    }

    public ready(plug: any) {
        this.plugin = plug
        console.log('[AppEvents] App ready');
    }

    public bwCreated() {
        app.on('open-url', (event, url) => {
            event.preventDefault()
            if (this.protocols.some((protocol: string) => url.includes(protocol))) {
                this.LinkHandler(url)
                console.log(url)
            }
        })

        this.InstanceHandler()
        this.InitTray()
    }

    /***********************************************************************************************************************
     * Private methods
     **********************************************************************************************************************/

    /**
     * Handles links (URI) and protocols for the application
     * @param arg
     */
    private LinkHandler(arg: string) {
        if (!arg) return;

        // LastFM Auth URL
        if (arg.includes('auth')) {
            let authURI = arg.split('/auth/')[1]
            if (authURI.startsWith('lastfm')) { // If we wanted more auth options
                const authKey = authURI.split('lastfm?token=')[1];
                utils.setStoreValue('lastfm.enabled', true);
                utils.setStoreValue('lastfm.auth_token', authKey);
                utils.getWindow().webContents.send('LastfmAuthenticated', authKey);
                this.plugin.callPlugin('lastfm', 'authenticate', authKey);
            }
        }
        // Play
        else if (arg.includes('/play/')) { //Steer away from protocol:// specific conditionals
            const playParam = arg.split('/play/')[1]

            const mediaType = {
                "s/": "song",
                "a/": "album",
                "p/": "playlist"
            }

            for (const [key, value] of Object.entries(mediaType)) {
                if (playParam.includes(key)) {
                    const id = playParam.split(key)[1]
                    utils.getWindow().webContents.send('play', value, id)
                    console.debug(`[LinkHandler] Attempting to load ${value} by id: ${id}`)
                }
            }

        } else if (arg.includes('music.apple.com')) { // URL (used with itms/itmss/music/musics uris)
            console.log(arg)
            let url = arg.split('//')[1]
            console.warn(`[LinkHandler] Attempting to load url: ${url}`);
            utils.getWindow().webContents.send('play', 'url', url)
        }
    }

    /**
     * Handles the creation of a new instance of the app
     */
    private InstanceHandler() {

        // Detects of an existing instance is running (So if the lock has been achieved, no existing instance has been found)
        const gotTheLock = app.requestSingleInstanceLock()

        if (!gotTheLock) { // Runs on the new instance if another instance has been found
            console.log('[Cider] Another instance has been found, quitting.')
            app.quit()
        } else { // Runs on the first instance if no other instance has been found
            app.on('second-instance', (_event, startArgs) => {
                console.log("[InstanceHandler] (second-instance) Instance started with " + startArgs.toString())

                startArgs.forEach(arg => {
                    console.log(arg)
                    if (arg.includes("cider://")) {
                        console.debug('[InstanceHandler] (second-instance) Link detected with ' + arg)
                        this.LinkHandler(arg)
                    } else if (arg.includes("--force-quit")) {
                        console.warn('[InstanceHandler] (second-instance) Force Quit found. Quitting App.');
                        app.quit()
                    } else if (utils.getWindow()) {
                        if (utils.getWindow().isMinimized()) utils.getWindow().restore()
                        utils.getWindow().focus()
                    }
                })
            })
        }

    }

    /**
     * Initializes the applications tray
     */
    private InitTray() {
        const icons = {
            "win32": nativeImage.createFromPath(path.join(__dirname, `../../resources/icons/icon.ico`)).resize({
                width: 32,
                height: 32
            }),
            "linux": nativeImage.createFromPath(path.join(__dirname, `../../resources/icons/icon.png`)).resize({
                width: 32,
                height: 32
            }),
            "darwin": nativeImage.createFromPath(path.join(__dirname, `../../resources/icons/icon.png`)).resize({
                width: 20,
                height: 20
            }),
        }

        this.tray = new Tray(process.platform === 'win32' ? icons.win32 : (process.platform === 'darwin' ? icons.darwin : icons.linux))
        this.tray.setToolTip(app.getName())
        this.setTray(false)

        this.tray.on('double-click', () => {
            if (utils.getWindow()) {
                if (utils.getWindow().isVisible()) {
                    utils.getWindow().focus()
                } else {
                    utils.getWindow().show()
                }
            }
        })

        utils.getWindow().on('show', () => {
            this.setTray(true)
        })

        utils.getWindow().on('restore', () => {
            this.setTray(true)
        })

        utils.getWindow().on('hide', () => {
            this.setTray(false)
        })

        utils.getWindow().on('minimize', () => {
            this.setTray(false)
        })
    }

    /**
     * Sets the tray context menu to a given state
     * @param visible - BrowserWindow Visibility
     */
    private setTray(visible: boolean = utils.getWindow().isVisible()) {
        this.i18n = utils.getLocale(utils.getStoreValue('general.language'))

        const menu = Menu.buildFromTemplate([
            {
                label: (visible ? this.i18n['action.tray.minimize'] : this.i18n['action.tray.show'].includes("{appName}") ? `${this.i18n['action.tray.show'].replace("{appName}", app.getName())}` : `${this.i18n['action.tray.show']} ${app.getName()}`),
                click: () => {
                    if (utils.getWindow()) {
                        if (visible) {
                            utils.getWindow().hide()
                        } else {
                            utils.getWindow().show()
                        }
                    }
                }
            },
            {
                label: this.i18n['action.tray.quit'],
                click: () => {
                    app.quit()
                }
            }
        ])
        this.tray.setContextMenu(menu)
    }
}
