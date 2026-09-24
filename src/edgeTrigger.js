import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const EDGE_WIDTH = 5;

// ==========================================
// ЗОНА ЧУТЛИВОСТІ (EDGE TRIGGER)
// ==========================================
//
// Невидимий (або напівпрозорий, якщо увімкнено індикатор) St.Widget
// вздовж лівого краю монітора. Сам по собі нічого не регулює — лише
// приймає події миші й розподіляє їх за вертикальною позицією курсора
// між переданими контролерами:
//   - верхня половина: медіа-керування (MprisController) / гучність;
//   - нижня половина: яскравість / перемикання стільниць;
//     довге утримання ЛКМ, як і раніше, вимикає монітор.
export class EdgeTrigger {
    constructor(
        settings,
        { mprisController, volumeBrightnessController, monitorPowerController },
    ) {
        this._settings = settings;
        this._mprisController = mprisController;
        this._volumeBrightnessController = volumeBrightnessController;
        this._monitorPowerController = monitorPowerController;

        this._edgeTrigger = null;
        this._monitorsChangedId = null;
        this._lowerLeftPressActive = false;
    }

    enable() {
        this._edgeTrigger = new St.Widget({
            name: "EdgeControlTrigger",
            width: EDGE_WIDTH,
            height: Main.layoutManager.primaryMonitor.height,
            x: 0,
            y: 0,
            reactive: true,
        });

        Main.layoutManager.addChrome(this._edgeTrigger);

        this._edgeTrigger.connect("scroll-event", (actor, event) =>
            this._onScroll(event),
        );
        this._edgeTrigger.connect("button-press-event", (actor, event) =>
            this._onButtonPress(event),
        );
        this._edgeTrigger.connect("button-release-event", (actor, event) =>
            this._onButtonRelease(event),
        );

        this._monitorsChangedId = Main.layoutManager.connect(
            "monitors-changed",
            () => this.applySettings(),
        );
    }

    _isUpperHalf(event) {
        const [, y] = event.get_coords();
        const halfHeight = Main.layoutManager.primaryMonitor.height / 2;
        return y < halfHeight;
    }

    _onScroll(event) {
        return this._isUpperHalf(event)
            ? this._volumeBrightnessController.handleVolumeScroll(event)
            : this._volumeBrightnessController.handleBrightnessScroll(event);
    }

    _onButtonPress(event) {
        if (this._isUpperHalf(event)) {
            return this._mprisController.handleButton(event);
        }

        const button = event.get_button();

        // Нижня зона:
        //   ПКМ — наступна стільниця;
        //   коротка ЛКМ — попередня стільниця;
        //   довга ЛКМ — вимкнення монітора.
        if (button === 3) {
            return this._switchWorkspace(Meta.MotionDirection.RIGHT);
        }

        if (button === 1) {
            this._lowerLeftPressActive = true;
            this._monitorPowerController.startLongPress();
            // Клік повністю належить EdgeControl; не віддаємо його
            // застосунку під курсором.
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onButtonRelease(event) {
        if (event.get_button() !== 1 || !this._lowerLeftPressActive) {
            return Clutter.EVENT_PROPAGATE;
        }

        this._lowerLeftPressActive = false;

        // Якщо таймер ще існує, довге натискання ще не спрацювало —
        // отже це короткий ЛКМ, який перемикає на попередню стільницю.
        const wasShortPress =
            this._monitorPowerController.cancelLongPress();

        if (wasShortPress) {
            return this._switchWorkspace(Meta.MotionDirection.LEFT);
        }

        // Таймер уже спрацював і монітор був вимкнений.
        return Clutter.EVENT_STOP;
    }

    _switchWorkspace(direction) {
        const workspaceManager = global.workspace_manager;
        const activeWorkspace = workspaceManager.get_active_workspace();
        const targetWorkspace = activeWorkspace?.get_neighbor(direction);

        if (!targetWorkspace || targetWorkspace === activeWorkspace) {
            return Clutter.EVENT_STOP;
        }

        targetWorkspace.activate(global.get_current_time());
        return Clutter.EVENT_STOP;
    }

    // Оновлює розмір/позицію/стиль зони чутливості (розмір та стиль)
    applySettings() {
        if (!this._edgeTrigger || !this._settings) return;

        const edgeWidth = this._settings.get_int("edge-width");
        const edgeHeightPercent = this._settings.get_int("edge-height");
        const showIndicator = this._settings.get_boolean(
            "edge-show-indicator",
        );

        const monitor = Main.layoutManager.primaryMonitor;
        const edgeHeight = Math.round(
            (monitor.height * edgeHeightPercent) / 100,
        );

        this._edgeTrigger.set_width(edgeWidth);
        this._edgeTrigger.set_height(edgeHeight);

        // Центруємо зону по вертикалі вздовж лівого краю монітора
        const edgeX = monitor.x;
        const edgeY = monitor.y + Math.round((monitor.height - edgeHeight) / 2);
        this._edgeTrigger.set_position(edgeX, edgeY);

        // Застосовуємо білий фон, якщо включено показ індикатора
        if (showIndicator) {
            this._edgeTrigger.set_style(
                "background-color: rgba(255, 255, 255, 0.5);",
            );
        } else {
            this._edgeTrigger.set_style("");
        }
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._edgeTrigger) {
            Main.layoutManager.removeChrome(this._edgeTrigger);
            this._edgeTrigger.destroy();
            this._edgeTrigger = null;
        }
        this._lowerLeftPressActive = false;
        this._mprisController = null;
        this._volumeBrightnessController = null;
        this._monitorPowerController = null;
        this._settings = null;
    }
}
