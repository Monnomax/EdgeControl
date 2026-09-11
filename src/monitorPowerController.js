import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// Скільки мс тримати ЛКМ, щоб вимкнути монітор (Long Press)
const MONITOR_OFF_LONG_PRESS_MS = 600;

// D-Bus координати org.gnome.Mutter.DisplayConfig
const DISPLAY_CONFIG_BUS_NAME = "org.gnome.Mutter.DisplayConfig";
const DISPLAY_CONFIG_OBJECT_PATH = "/org/gnome/Mutter/DisplayConfig";
const DISPLAY_CONFIG_INTERFACE = "org.gnome.Mutter.DisplayConfig";

// ==========================================
// БЛОК ВИМКНЕННЯ / ВВІМКНЕННЯ МОНІТОРА
// ==========================================
//
// Довге утримання ЛКМ у нижній половині зони чутливості вимикає монітор
// через org.gnome.Mutter.DisplayConfig. Поки монітор вимкнено, тримається
// модальний grab на невидимому "приймачі" кліків, який будь-яким кліком
// вмикає монітор назад.
export class MonitorPowerController {
    constructor() {
        this._monitorIsOff = false;
        this._monitorOffPressId = null;
        this._wakeOverlay = null;
        this._wakeModalGrab = null;
        this._wakeCapturedEventId = null;
    }

    startLongPress() {
        this.cancelLongPress();
        this._monitorOffPressId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            MONITOR_OFF_LONG_PRESS_MS,
            () => {
                this._monitorOffPressId = null;
                this._turnMonitorOff();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    cancelLongPress() {
        if (this._monitorOffPressId) {
            GLib.Source.remove(this._monitorOffPressId);
            this._monitorOffPressId = null;
        }
    }

    // Аналог: busctl --user set-property org.gnome.Mutter.DisplayConfig
    //   /org/gnome/Mutter/DisplayConfig org.gnome.Mutter.DisplayConfig PowerSaveMode i <mode>
    _setMonitorPowerSaveMode(mode) {
        Gio.DBus.session.call(
            DISPLAY_CONFIG_BUS_NAME,
            DISPLAY_CONFIG_OBJECT_PATH,
            "org.freedesktop.DBus.Properties",
            "Set",
            new GLib.Variant("(ssv)", [
                DISPLAY_CONFIG_INTERFACE,
                "PowerSaveMode",
                new GLib.Variant("i", mode),
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    logError(
                        e,
                        "EdgeControl: не вдалося змінити PowerSaveMode",
                    );
                }
            },
        );
    }

    _turnMonitorOff() {
        if (this._monitorIsOff) return;
        this._monitorIsOff = true;
        this._setMonitorPowerSaveMode(1);
        this._startWakeOnClickWatcher();
    }

    _turnMonitorOn() {
        if (!this._monitorIsOff) return;
        this._monitorIsOff = false;
        this._setMonitorPowerSaveMode(0);
        this._stopWakeOnClickWatcher();
    }

    // Невидимий "приймач" кліків. Поки на нього тримається модальний grab,
    // ВСІ натискання миші (де б не був курсор і яке б вікно не було
    // сфокусоване) маршрутизуються саме сюди, а не в застосунок під курсором.
    // Це той самий механізм, яким користуються екран блокування й Overview.
    _ensureWakeOverlay() {
        if (this._wakeOverlay) return;

        this._wakeOverlay = new Clutter.Actor({
            name: "EdgeControlWakeOverlay",
            reactive: true,
            opacity: 0,
        });

        this._wakeOverlay.connect("button-press-event", () => {
            this._turnMonitorOn();
            // Більше нічого не робимо — клік лише "розбудив" монітор
            return Clutter.EVENT_STOP;
        });

        Main.layoutManager.addChrome(this._wakeOverlay);
        this._wakeOverlay.hide();
    }

    // Розтягуємо приймач на всю площу усіх моніторів (на випадок кількох
    // екранів) — хоча для самого grab-у це не критично: модальний grab
    // переадресовує події незалежно від геометрії актора.
    _resizeWakeOverlayToScreen() {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;

        for (const monitor of Main.layoutManager.monitors) {
            minX = Math.min(minX, monitor.x);
            minY = Math.min(minY, monitor.y);
            maxX = Math.max(maxX, monitor.x + monitor.width);
            maxY = Math.max(maxY, monitor.y + monitor.height);
        }

        this._wakeOverlay.set_position(minX, minY);
        this._wakeOverlay.set_size(maxX - minX, maxY - minY);
    }

    // Поки монітор вимкнено — забираємо собі ВСІ натискання миші через
    // справжній модальний grab (а не пасивне прослуховування), щоб клік
    // спрацьовував незалежно від позиції курсора й того, чи є під ним
    // активне вікно застосунку.
    _startWakeOnClickWatcher() {
        this._ensureWakeOverlay();
        this._resizeWakeOverlayToScreen();
        this._wakeOverlay.show();

        this._wakeModalGrab = Main.pushModal(this._wakeOverlay, {
            actionMode: Shell.ActionMode.NONE,
        });

        // Якщо з якоїсь причини grab не вдався — підстраховуємось старим
        // способом (глобальне прослуховування подій на сцені)
        if (!this._wakeModalGrab) {
            this._wakeCapturedEventId = global.stage.connect(
                "captured-event",
                (actor, event) => this._onCapturedEventWhileOff(event),
            );
        }
    }

    _stopWakeOnClickWatcher() {
        if (this._wakeModalGrab) {
            Main.popModal(this._wakeModalGrab);
            this._wakeModalGrab = null;
        }
        if (this._wakeCapturedEventId) {
            global.stage.disconnect(this._wakeCapturedEventId);
            this._wakeCapturedEventId = null;
        }
        if (this._wakeOverlay) this._wakeOverlay.hide();
    }

    // Запасний варіант (вживається лише якщо pushModal не вдався)
    _onCapturedEventWhileOff(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            this._turnMonitorOn();
            // Ковтаємо саме цей клік, яким користувач "пробудив" монітор,
            // щоб він не потрапив у вікно під курсором
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    disable() {
        this.cancelLongPress();
        this._stopWakeOnClickWatcher();
        if (this._wakeOverlay) {
            Main.layoutManager.removeChrome(this._wakeOverlay);
            this._wakeOverlay.destroy();
            this._wakeOverlay = null;
        }
        if (this._monitorIsOff) {
            this._monitorIsOff = false;
            this._setMonitorPowerSaveMode(0);
        }
    }
}
