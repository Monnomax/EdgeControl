import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

// ==========================================
// БЛОК MPRIS (КЕРУВАННЯ МЕДІА)
// ==========================================
//
// Стежить за появою/зникненням MPRIS-плеєрів та їх станом відтворення,
// а також обробляє клік по зоні чутливості для previous/next/play-pause,
// показуючи результат у переданому CustomOsd.
export class MprisController {
    constructor(osd) {
        this._osd = osd;

        this._activePlayerName = null;
        this._isPlaying = false;
        this._currentTrackTitle = "";

        // NameOwnerChanged оперує well-known іменами шини
        // (org.mpris.MediaPlayer2.spotify), а PropertiesChanged передає в
        // callback лише унікальне ім'я з'єднання відправника (":1.55").
        // Без цієї мапи ці два ідентифікатори одного й того ж плеєра
        // ніколи не збігаються під час порівняння, і при закритті плеєра
        // _activePlayerName "застряє" зі старим значенням.
        this._ownerNames = new Map();

        this._nameOwnerId = null;
        this._mprisSignalId = null;
    }

    enable() {
        // 1. Моніторинг появи нових плеєрів або їх закриття
        this._nameOwnerId = Gio.DBus.session.signal_subscribe(
            "org.freedesktop.DBus",
            "org.freedesktop.DBus",
            "NameOwnerChanged",
            "/org/freedesktop/DBus",
            null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, objPath, iface, sigName, params) => {
                let [name, oldOwner, newOwner] = params.recursiveUnpack();
                if (name.startsWith("org.mpris.MediaPlayer2.")) {
                    if (newOwner === "") {
                        // Плеєр закрився — прибираємо застарілий запис
                        // мапи власників і, якщо це був активний плеєр,
                        // повністю скидаємо стан (включно з назвою треку,
                        // яку показує OSD), щоб не лишалось "привида"
                        // старої пісні після закриття плеєра.
                        this._ownerNames.delete(oldOwner);
                        if (this._activePlayerName === name) {
                            this._activePlayerName = null;
                            this._isPlaying = false;
                            this._currentTrackTitle = "";
                            this._osd.updateVisibleTitle("");
                            this._findActivePlayer();
                        }
                    } else {
                        // Плеєр відкрився — запам'ятовуємо, яке унікальне
                        // ім'я з'єднання відповідає цьому well-known імені,
                        // щоб надалі коректно розпізнавати цей самий плеєр
                        // у подіях PropertiesChanged.
                        this._ownerNames.set(newOwner, name);
                        this._checkPlayerStatus(name);
                    }
                }
            },
        );

        // 2. Глобальна підписка на зміни (PropertiesChanged)
        this._mprisSignalId = Gio.DBus.session.signal_subscribe(
            null,
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
            "/org/mpris/MediaPlayer2",
            null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, objPath, iface, sigName, params) => {
                this._onMprisPropertiesChanged(sender, params);
            },
        );

        this._findActivePlayer();
    }

    _onMprisPropertiesChanged(sender, params) {
        let [changedIface, changedProps] = params.recursiveUnpack();
        if (changedIface !== "org.mpris.MediaPlayer2.Player") return;

        // "sender" — це унікальне ім'я з'єднання (":1.55"), а
        // _activePlayerName ми зберігаємо як well-known ім'я шини
        // (org.mpris.MediaPlayer2.spotify), яке приходить у
        // NameOwnerChanged. Перекладаємо через мапу власників, інакше
        // порівняння нижче ніколи не збігалось би.
        const senderName = this._ownerNames.get(sender) || sender;

        // Якщо це новий плеєр і він почав грати — перемикаємо увагу на нього
        if (changedProps.PlaybackStatus === "Playing") {
            this._activePlayerName = senderName;
            this._isPlaying = true;
        }

        if (changedProps.Metadata) {
            this._activePlayerName = senderName;
            this._updateMetadata(changedProps.Metadata);
        }

        if (changedProps.PlaybackStatus) {
            if (this._activePlayerName === senderName) {
                this._isPlaying = changedProps.PlaybackStatus === "Playing";
            }
        }
    }

    _updateMetadata(metadata) {
        if (!metadata) return;

        const extract = (val) => {
            if (val === null || val === undefined) return "";
            let text = typeof val.unpack === "function" ? val.unpack() : val;
            // Очищаємо від переносу рядків, щоб не ламати висоту OSD
            return String(text)
                .replace(/[\r\n]+/g, " ")
                .trim();
        };

        let title = extract(metadata["xesam:title"]);
        let artistData = extract(metadata["xesam:artist"]);
        let artist = Array.isArray(artistData)
            ? artistData.join(", ")
            : artistData;

        if (artist && title) {
            this._currentTrackTitle = `${artist} — ${title}`;
        } else if (title) {
            this._currentTrackTitle = title;
        } else {
            this._currentTrackTitle = "Невідомий трек";
        }

        this._osd.updateVisibleTitle(this._currentTrackTitle);
    }

    _findActivePlayer() {
        Gio.DBus.session.call(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "ListNames",
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    let [names] = conn.call_finish(res).recursiveUnpack();
                    let players = names.filter((n) =>
                        n.startsWith("org.mpris.MediaPlayer2."),
                    );
                    players.forEach((p) => this._checkPlayerStatus(p));
                } catch (e) {}
            },
        );
    }

    // Дізнається унікальне ім'я з'єднання (":1.NN"), яке зараз володіє
    // цим well-known іменем шини, і запам'ятовує пару в мапі власників.
    // Потрібно для плеєрів, які вже були запущені до enable() — для них
    // NameOwnerChanged (де ця пара приходить "безкоштовно") ніколи не
    // спрацює, тож без цього виклику мапа лишалась би без запису.
    _rememberOwnerOf(name) {
        Gio.DBus.session.call(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "GetNameOwner",
            new GLib.Variant("(s)", [name]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    let [owner] = conn.call_finish(res).recursiveUnpack();
                    this._ownerNames.set(owner, name);
                } catch (e) {}
            },
        );
    }

    _checkPlayerStatus(name) {
        this._rememberOwnerOf(name);

        Gio.DBus.session.call(
            name,
            "/org/mpris/MediaPlayer2",
            "org.freedesktop.DBus.Properties",
            "Get",
            new GLib.Variant("(ss)", [
                "org.mpris.MediaPlayer2.Player",
                "PlaybackStatus",
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    let status = conn.call_finish(res).recursiveUnpack()[0];
                    let currentStatus =
                        typeof status.unpack === "function"
                            ? status.unpack()
                            : status;

                    if (
                        currentStatus === "Playing" ||
                        !this._activePlayerName
                    ) {
                        this._activePlayerName = name;
                        this._isPlaying = currentStatus === "Playing";
                        this._fetchInitialMetadata(name);
                    }
                } catch (e) {}
            },
        );
    }

    _fetchInitialMetadata(name) {
        Gio.DBus.session.call(
            name,
            "/org/mpris/MediaPlayer2",
            "org.freedesktop.DBus.Properties",
            "Get",
            new GLib.Variant("(ss)", [
                "org.mpris.MediaPlayer2.Player",
                "Metadata",
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    let meta = conn.call_finish(res).recursiveUnpack()[0];
                    this._updateMetadata(meta);
                } catch (e) {}
            },
        );
    }

    _sendMprisCommand(action) {
        if (!this._activePlayerName) return;
        const method = action.charAt(0).toUpperCase() + action.slice(1);

        // Асинхронний виклик без блокування UI (Fire and forget)
        Gio.DBus.session.call(
            this._activePlayerName,
            "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
            method,
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null,
        );
    }

    // Викликається зоною чутливості при натисканні лівої/середньої/правої
    // кнопки миші у верхній половині (зона медіа-керування).
    handleButton(event) {
        const button = event.get_button();
        let action =
            button === 1
                ? "previous"
                : button === 3
                  ? "next"
                  : button === 2
                    ? "playPause"
                    : null;
        if (!action) return Clutter.EVENT_PROPAGATE;

        // Немає жодного активного плеєра — керувати нічим (ні перемкнути
        // трек, ні поставити на паузу), тож для будь-якої з трьох дій
        // показуємо іконку "недоступно" замість оптимістичної зміни
        // іконки/стану.
        if (!this._activePlayerName) {
            this._osd.show({
                icon: "action-unavailable-symbolic",
                level: -1,
                title: "",
            });
            this._findActivePlayer();
            return Clutter.EVENT_STOP;
        }

        let iconName =
            action === "previous"
                ? "media-skip-backward-symbolic"
                : "media-skip-forward-symbolic";

        if (action === "playPause") {
            iconName = this._isPlaying
                ? "media-playback-pause-symbolic"
                : "media-playback-start-symbolic";
            this._isPlaying = !this._isPlaying; // Оптимістичне перемикання для іконки
        }

        // Показуємо вікно МИТТЄВО з поточною відомою інформацією
        this._osd.show({
            icon: iconName,
            level: -1,
            title: this._currentTrackTitle,
        });

        // Відправляємо команду плеєру. Коли він її виконає, _onMprisPropertiesChanged оновить текст.
        this._sendMprisCommand(action);

        return Clutter.EVENT_STOP;
    }

    disable() {
        if (this._nameOwnerId) {
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerId);
            this._nameOwnerId = null;
        }
        // ВАЖЛИВО: Відписуємося від D-Bus при вимкненні розширення
        if (this._mprisSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._mprisSignalId);
            this._mprisSignalId = null;
        }
        this._ownerNames.clear();
        this._osd = null;
    }
}
