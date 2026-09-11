import Clutter from "gi://Clutter";
import St from "gi://St";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// ==========================================
// ВЛАСНИЙ OSD-КОНТЕЙНЕР
// ==========================================
//
// Відповідає за побудову власного OSD-вікна (іконка + значення + назва
// треку + смужка прогресу), застосування стилів з налаштувань розширення,
// показ/приховування з таймером зникнення та "розігрів" рендерингу перед
// першим реальним використанням.
export class CustomOsd {
    constructor(settings, interfaceSettings) {
        this._settings = settings;
        this._interfaceSettings = interfaceSettings;

        this._lastLevel = -1;
        this._containerExtraWidth = 0;
        this._osdMaxWidth = 0;
        this._barPaddingLeft = 0;
        this._barPaddingRight = 0;
        this._baseOsdHeight = 0;
        this._barExtraHeight = 0;
        this._showBarPref = true;
        this._iconBaseStyle = "";

        this._osdTimeoutId = null;
        this._warmUpIdleId = null;
        this._startupCompleteId = null;
        this._borderProbeActor = null;

        this._buildWidgets();
    }

    // ==========================================
    // ІНІЦІАЛІЗАЦІЯ ВІКНА ТА АНІМАЦІЇ
    // ==========================================

    _buildWidgets() {
        this._osdContainer = new St.BoxLayout({
            // Клас "notification-banner" дає нам готові background-color,
            // color та box-shadow прямо з теми (gnome-shell.css), тож не
            // треба тримати власні налаштування кольору фону/тіні/елементів.
            style_class: "custom-osd-window notification-banner",
            vertical: true,
            visible: false,
            reactive: true,
        });

        this._osdContainer.connect("enter-event", () => {
            if (
                !this._settings ||
                !this._settings.get_boolean("osd-hide-on-hover")
            ) {
                return Clutter.EVENT_STOP;
            }

            if (this._osdTimeoutId) {
                GLib.Source.remove(this._osdTimeoutId);
                this._osdTimeoutId = null;
            }

            this._osdContainer.visible = false;
            this._osdContainer.opacity = 255;
            return Clutter.EVENT_STOP;
        });

        this._osdHeader = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
        });
        // Обрізаємо вміст рядка (іконка + значення + назва) по його
        // межах — а не по межах _osdContainer. Якщо обрізати сам
        // контейнер, разом із зайвим вмістом ріжеться і його box-shadow
        // (тінь), яка малюється темою за межами border-box контейнера.
        this._osdHeader.clip_to_allocation = true;

        this._osdIcon = new St.Icon({
            style_class: "custom-osd-icon",
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._osdLabel = new St.Label({
            style_class: "custom-osd-label",
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._osdTitleLabel = new St.Label({
            style_class: "custom-osd-title-label",
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._osdTitleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        // Окремий контейнер для тексту (значення + назва треку), щоб
        // відступи шрифту (osd-font-padding-*) можна було застосовувати
        // до тексту незалежно від іконки — як власний margin навколо
        // цього блоку, а не як спільний padding усього контейнера OSD.
        this._osdTextBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._osdTextBox.add_child(this._osdLabel);
        this._osdTextBox.add_child(this._osdTitleLabel);

        this._osdHeader.add_child(this._osdIcon);
        this._osdHeader.add_child(this._osdTextBox);

        this._osdBarBg = new St.BoxLayout({
            // Клас "ws-switcher-indicator" дає готовий background-color
            // прямо з теми (gnome-shell.css) для неактивної (фонової)
            // частини смужки.
            style_class: "custom-osd-bar-bg ws-switcher-indicator",
            x_align: Clutter.ActorAlign.START,
        });
        this._osdBarFill = new St.Widget({
            // Той самий клас, але з форсованим псевдо-класом ":active" —
            // це дає колір/прозорість активної (заповненої) частини з
            // правила ".ws-switcher-indicator:active" у темі.
            style_class: "custom-osd-bar-fill ws-switcher-indicator",
        });
        this._osdBarFill.add_style_pseudo_class("active");
        this._osdBarBg.add_child(this._osdBarFill);

        this._osdContainer.add_child(this._osdHeader);
        this._osdContainer.add_child(this._osdBarBg);
        Main.uiGroup.add_child(this._osdContainer);

        // Ширина смужки прогресу і самого контейнера більше не залежать
        // від фіксованих пікселів — вони підлаштовуються під фактичну
        // ширину заголовка (іконка + значення + назва треку).
        //
        // ВАЖЛИВО: клас "notification-banner" (потрібен нам для кольору
        // фону/тіні/тексту з теми) у gnome-shell.css сам має фіксовану
        // ширину — усі банери сповіщень в системі формування однакової ширини за
        // задумом теми. Просто CSS тут не переб'є, тож примусово
        // виставляємо ширину контейнера через set_width() — це властивість
        // самого Clutter-актора, яка має пріоритет над шириною з теми.
        this._syncContentWidth = () => {
            if (!this._osdHeader || !this._osdContainer) return;

            // ВИПРАВЛЕННЯ: Використовуємо get_preferred_width(-1) щоб отримати бажану
            // (природну) ширину контенту. Поточна виділена ширина (this._osdHeader.width)
            // може бути хибною, якщо контейнер вже був жорстко обмежений попереднім set_width().
            const [, naturalHeaderWidth] =
                this._osdHeader.get_preferred_width(-1);
            if (naturalHeaderWidth <= 0) return;

            const naturalWidth = naturalHeaderWidth + this._containerExtraWidth;
            const maxWidth = this._osdMaxWidth || 0;
            const containerWidth =
                maxWidth > 0 ? Math.min(naturalWidth, maxWidth) : naturalWidth;

            // Ширина рядка контенту (хедера) — це ширина контейнера мінус
            // ті самі відступи та рамка, що додавались до неї вище.
            const contentWidth = containerWidth - this._containerExtraWidth;

            // Смужка прогресу має власні горизонтальні відступи
            // (osd-bar-padding-left/right), які НЕ входять у
            // _containerExtraWidth (той рахує лише рамку). Тому для
            // смужки віднімаємо їх окремо — інакше ширина смужки разом з
            // її margin-left/margin-right перевищує ширину контейнера і
            // смужка "вилазить" за праву межу.
            const barPaddingLeft = this._barPaddingLeft || 0;
            const barPaddingRight = this._barPaddingRight || 0;
            const barContentWidth = Math.max(
                0,
                contentWidth - barPaddingLeft - barPaddingRight,
            );

            if (this._osdBarBg) this._osdBarBg.set_width(barContentWidth);
            if (this._osdBarFill && this._lastLevel > -1) {
                this._osdBarFill.set_width(barContentWidth * this._lastLevel);
            }

            this._osdContainer.set_width(containerWidth);
        };
        this._osdHeader.connect("notify::allocation", this._syncContentWidth);

        this._updatePosition = () => {
            const monitor = Main.layoutManager.primaryMonitor;
            const pos = this._settings.get_string("osd-position");
            const margin = this._settings.get_int("osd-edge-margin");

            let x, y;
            if (pos.includes("left")) x = monitor.x + margin;
            else if (pos.includes("right"))
                x =
                    monitor.x +
                    monitor.width -
                    this._osdContainer.width -
                    margin;
            else x = monitor.x + (monitor.width - this._osdContainer.width) / 2;

            if (pos.includes("top")) y = monitor.y + margin;
            else if (pos.includes("bottom"))
                y =
                    monitor.y +
                    monitor.height -
                    this._osdContainer.height -
                    margin;
            else
                y =
                    monitor.y +
                    (monitor.height - this._osdContainer.height) / 2;

            this._osdContainer.set_position(x, y);
        };

        this._osdContainer.connect("notify::allocation", this._updatePosition);
    }

    // ==========================================
    // БЛОК СТИЛІВ
    // ==========================================

    // Дізнається, яким саме є border-color, який тема оболонки визначає
    // для класу ".notification-banner" (властивість "border" у
    // gnome-shell.css), і повертає його у вигляді rgba()-рядка, готового
    // для інлайн-стилю. Для цього створюється малопомітний "пробний"
    // St.Widget лише з класом "notification-banner" (без жодних власних
    // inline-стилів чи інших класів, які могли б щось перебити) — його
    // theme_node показує саме те значення border-color, яке реально задає
    // тема для цього класу, незалежно від того, як наш власний контейнер
    // комбінує "custom-osd-window notification-banner" та inline
    // border-width. Пробний актор додається до Main.uiGroup один раз і
    // лишається прихованим (потрібен лише для читання теми).
    _getThemeBorderColor() {
        if (!this._borderProbeActor) {
            this._borderProbeActor = new St.Widget({
                style_class: "notification-banner",
            });
            this._borderProbeActor.hide();
            Main.uiGroup.add_child(this._borderProbeActor);
        }

        const themeNode = this._borderProbeActor.get_theme_node();
        const color = themeNode.get_border_color(St.Side.TOP);

        return `rgba(${color.red}, ${color.green}, ${color.blue}, ${(color.alpha / 255).toFixed(3)})`;
    }

    applySettings() {
        if (!this._settings) return;

        // Використовуємо виключно системний шрифт, обраний користувачем
        // у налаштуваннях GNOME (org.gnome.desktop.interface, font-name),
        // а не власний шрифт розширення.
        const fontFull = this._interfaceSettings
            ? this._interfaceSettings.get_string("font-name")
            : "Cantarell 11";
        let fontParts = fontFull.split(" ");
        fontParts.pop(); // Розмір шрифту нам тут не потрібен.
        let fontWeight = "normal";
        let fontStyleType = "normal";

        const weightMap = {
            thin: "100",
            extralight: "200",
            light: "300",
            regular: "400",
            medium: "500",
            semibold: "600",
            bold: "bold",
            black: "900",
        };

        if (fontParts.length > 0) {
            let lastPart = fontParts[fontParts.length - 1].toLowerCase();
            if (lastPart.includes("italic")) {
                fontStyleType = "italic";
                fontParts.pop();
                if (fontParts.length > 0)
                    lastPart = fontParts[fontParts.length - 1].toLowerCase();
            }
            if (weightMap[lastPart]) {
                fontWeight = weightMap[lastPart];
                fontParts.pop();
            }
        }
        const fontFamily = fontParts.join(" ");
        const fontBaseCSS = `font-family: '${fontFamily}'; font-weight: ${fontWeight}; font-style: ${fontStyleType};`;

        const paddingTop = this._settings.get_int("osd-padding-top");
        const paddingRight = this._settings.get_int("osd-padding-right");
        const paddingBottom = this._settings.get_int("osd-padding-bottom");
        const paddingLeft = this._settings.get_int("osd-padding-left");
        const radius = this._settings.get_int("osd-border-radius");
        this._showBarPref = this._settings.get_boolean("show-osd-bar");

        const borderShow = this._settings.get_boolean("osd-border-show");
        const borderWidth = this._settings.get_int("osd-border-width");

        const barHeight = this._settings.get_int("osd-bar-height");
        const barRadius = this._settings.get_int("osd-bar-radius");

        const osdHeight = this._settings.get_int("osd-height");
        this._osdMaxWidth = this._settings.get_int("osd-max-width");

        const borderTotal = (borderShow ? borderWidth : 0) * 2;

        // Віднімаємо лише відступи. Товщина рамки більше не впливає на розмір іконки.
        const availableIconHeight = osdHeight - paddingTop - paddingBottom - 1;
        const iconSize = Math.max(8, Math.round(availableIconHeight));

        // Відступи смужки прогресу — повністю незалежна четвірка
        // margin-значень (група "Відступи смужки прогресу"), за тим самим
        // принципом, що й відступи іконки/шрифту. top/bottom також
        // визначають, скільки додаткового простору (barExtraHeight)
        // виділяється під смужку в контейнері (див. нижче).
        const barPaddingTop = this._settings.get_int("osd-bar-padding-top");
        const barPaddingRight = this._settings.get_int("osd-bar-padding-right");
        const barPaddingBottom = this._settings.get_int(
            "osd-bar-padding-bottom",
        );
        const barPaddingLeft = this._settings.get_int("osd-bar-padding-left");
        const barExtraHeight = this._showBarPref
            ? barHeight + barPaddingTop + barPaddingBottom
            : 0;

        // _syncContentWidth() (визначена один раз у _buildWidgets()) рахує
        // ширину смужки окремо від ширини хедера, тож їй потрібні власні
        // горизонтальні відступи смужки — зберігаємо їх тут як поля
        // екземпляра, щоб не дублювати виклик get_int().
        this._barPaddingLeft = barPaddingLeft;
        this._barPaddingRight = barPaddingRight;

        const fontPaddingTop = this._settings.get_int("osd-font-padding-top");
        const fontPaddingRight = this._settings.get_int(
            "osd-font-padding-right",
        );
        const fontPaddingBottom = this._settings.get_int(
            "osd-font-padding-bottom",
        );
        const fontPaddingLeft = this._settings.get_int("osd-font-padding-left");

        // Товщина рамки більше не впливає на доступну висоту для шрифту
        const availableFontHeight = Math.max(
            0,
            osdHeight - fontPaddingTop - fontPaddingBottom,
        );
        const labelFontSize = Math.max(
            6,
            Math.round(availableFontHeight * 0.6),
        );
        const titleFontSize = Math.max(6, Math.round(labelFontSize * 0.7));

        if (this._osdContainer) {
            // Раніше ми розраховували, що border-color підхопиться сам,
            // каскадом, з теми ("border" у ".notification-banner"), якщо
            // просто не перевизначати цю властивість інлайн-стилем. На
            // практиці St змішує inline border-width з border-color/style
            // з теми не так надійно, як звичайний CSS-каскад у браузері,
            // тож колір рамки міг "губитись". Тепер натомість явно
            // ЗАПИТУЄМО у теми, яким саме є border-color класу
            // ".notification-banner" (через _getThemeBorderColor()), і
            // застосовуємо це значення напряму — гарантовано той самий
            // колір, що й border у темі.
            const borderColor = this._getThemeBorderColor();

            this._osdContainer.set_style(`
                ${fontBaseCSS}
                border-radius: ${radius}px;
                border-width: ${borderShow ? borderWidth : 0}px;
                border-color: ${borderColor};
                margin: 0;
            `);

            // Додаткова ширина контейнера залежить ТІЛЬКИ від товщини рамки.
            // Усі горизонтальні margins елементів уже містяться всередині ширини _osdHeader.
            this._containerExtraWidth = (borderShow ? borderWidth : 0) * 2;

            // ДОДАЄМО товщину рамки до базової висоти, щоб рамка росла назовні
            this._baseOsdHeight = osdHeight + borderTotal;
            this._barExtraHeight = barExtraHeight;
            this._updateContainerHeight();
        }

        if (this._osdHeader) {
            // Змушуємо хедер розтягуватися на всю висоту контейнера (мінус рамка),
            // щоб внутрішнє вирівнювання по центру працювало коректно.
            this._osdHeader.y_expand = true;
            this._osdHeader.y_align = Clutter.ActorAlign.FILL;
            this._osdHeader.set_style(`align-items: center;`);
        }

        if (this._osdIcon) {
            this._osdIcon.icon_size = iconSize;
            // Переносимо системні відступи іконки в її власні margins —
            // ліва й права межі беруть власні значення налаштувань.
            this._iconBaseStyle = `
                margin-top: ${paddingTop}px;
                margin-right: ${paddingRight}px;
                margin-bottom: ${paddingBottom + 1}px;
                margin-left: ${paddingLeft}px;
            `;
            this._osdIcon.set_style(this._iconBaseStyle);
        }

        if (this._osdLabel) {
            this._osdLabel.set_style(
                `${fontBaseCSS} font-size: ${labelFontSize}pt;`,
            );
        }

        if (this._osdTitleLabel) {
            this._osdTitleLabel.set_style(
                `${fontBaseCSS} font-size: ${titleFontSize}pt;`,
            );
        }

        if (this._osdTextBox) {
            // Власні відступи текстового блоку — ліва й права межі
            // беруть власні значення налаштувань.
            // (spacing: 15px тут — це інтервал МІЖ значенням і назвою
            // треку всередині самого текстового блоку, не чіпаємо його.)
            this._osdTextBox.set_style(`
                spacing: 15px;
                margin-top: ${fontPaddingTop}px;
                margin-right: ${fontPaddingRight}px;
                margin-bottom: ${fontPaddingBottom}px;
                margin-left: ${fontPaddingLeft}px;
            `);
        }

        if (this._osdBarBg) {
            // Власні відступи смужки прогресу — більше не залежать від
            // відступів іконки чи шрифту.
            this._osdBarBg.set_style(
                `border-radius: ${barRadius}px; height: ${barHeight}px; margin: ${barPaddingTop}px ${barPaddingRight}px ${barPaddingBottom}px ${barPaddingLeft}px; padding: 0;`,
            );
        }

        if (this._osdBarFill) {
            this._osdBarFill.set_style(
                `border-radius: ${barRadius}px; height: ${barHeight}px; margin: 0; padding: 0;`,
            );
        }

        if (this._syncContentWidth) this._syncContentWidth();
        if (this._updatePosition) this._updatePosition();
    }

    // Встановлює фактичну висоту _osdContainer: базова висота
    // (_baseOsdHeight) плюс додатковий простір під смужку прогресу
    // (_barExtraHeight), але лише якщо смужка ЗАРАЗ реально видима
    // (this._osdBarBg.visible). Тобто збільшення висоти стосується
    // тільки тих викликів show(), де є рівень (гучність, яскравість) і
    // показ смужки увімкнено в налаштуваннях — а не керування плеєром
    // (previous/next/play-pause) чи інших OSD без рівня, для яких смужка
    // й так прихована.
    _updateContainerHeight() {
        if (!this._osdContainer) return;

        const barVisible = !!(this._osdBarBg && this._osdBarBg.visible);
        const height =
            (this._baseOsdHeight || 0) +
            (barVisible ? this._barExtraHeight || 0 : 0);

        this._osdContainer.set_height(height);
    }

    // ==========================================
    // "РОЗІГРІВ" ВІДОБРАЖЕННЯ ПЕРЕД ПЕРШИМ ВИКОРИСТАННЯМ
    // ==========================================
    //
    // Одразу після входу в систему GNOME Shell ще може не "розігріти"
    // Pango/Cairo-кеш для шрифту, обраного користувачем у системі, та/або
    // ще триває стартова анімація робочого столу. Якщо саме в цей момент
    // користувач перший раз покрутить колесо миші (гучність/яскравість),
    // то caching цей перший показ OSD може мати неправильні розміри й
    // позицію елементів (іконка виглядає "піднятою", OSD стиснуте по
    // ширині) — і так стається лише один раз, бо після першого повного
    // циклу розкладки+малювання все вже "прогріте" й надалі рендериться
    // коректно.
    //
    // Щоб користувач не бачив цього зламаного першого кадру, ми самі
    // примусово виконуємо один невидимий (opacity: 0) цикл показу OSD
    // ще до того, як він може знадобитися по-справжньому.
    warmUp() {
        if (!this._osdContainer) return;

        // Якщо стартова анімація GNOME Shell ще не завершилась — чекаємо
        // на сигнал "startup-complete" і розігріваємось вже після неї,
        // інакше сам розігрів може відбутися в "неготовому" середовищі.
        if (Main.layoutManager._startingUp) {
            this._startupCompleteId = Main.layoutManager.connect(
                "startup-complete",
                () => {
                    if (this._startupCompleteId) {
                        Main.layoutManager.disconnect(this._startupCompleteId);
                        this._startupCompleteId = null;
                    }
                    this.warmUp();
                },
            );
            return;
        }

        this._osdContainer.opacity = 0;
        this._osdIcon.icon_name = "audio-volume-high-symbolic";
        this._osdLabel.text = "100";
        this._osdLabel.visible = true;
        this._osdTitleLabel.text = "";
        this._osdTitleLabel.visible = false;
        this._osdBarBg.visible = false;
        this._osdContainer.visible = true;

        // Одного проходу головного циклу подій достатньо, щоб Clutter
        // встиг виконати повний цикл розкладки (layout) та малювання
        // (paint) — саме це й "розігріває" шрифт та текстуру іконки.
        // Після цього повертаємо OSD у звичний прихований стан, готовий
        // до першого реального використання.
        this._warmUpIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._warmUpIdleId = null;
            if (!this._osdContainer) return GLib.SOURCE_REMOVE;

            this._osdContainer.visible = false;
            this._osdContainer.opacity = 255;
            this._osdLabel.text = "";
            this._osdTitleLabel.text = "";
            this._lastLevel = -1;

            return GLib.SOURCE_REMOVE;
        });
    }

    // ==========================================
    // ПОКАЗ OSD
    // ==========================================

    show({ icon, level = -1, title = "" }) {
        if (this._osdIcon) {
            this._osdIcon.icon_name = icon;
            const iconColor =
                icon === "action-unavailable-symbolic"
                    ? "rgb(175, 30, 45)"
                    : "";
            this._osdIcon.set_style(
                `${this._iconBaseStyle}${iconColor ? `color: ${iconColor};` : ""}`,
            );
        }

        if (this._osdLabel) {
            let value = Math.round(level * 100);
            const showPercent = this._settings.get_boolean(
                "show-percent-symbol",
            );
            this._osdLabel.text =
                level > -1 ? `${value}${showPercent ? "%" : ""}` : "";
            this._osdLabel.visible = level > -1;
        }

        if (this._osdTitleLabel) {
            this._osdTitleLabel.text = title;
            this._osdTitleLabel.visible = title !== "";
        }

        // Якщо в текстовому блоці немає жодного видимого дочірнього
        // елемента (ні значення, ні назви треку — наприклад, коли
        // показується лише іконка), ховаємо сам _osdTextBox цілком.
        // Інакше його власні margin-left/margin-right (osd-font-padding-*)
        // додавали б "невидимий" простір праворуч від іконки, і відступи
        // зліва/справа від іконки переставали б бути однаковими.
        if (this._osdTextBox) {
            const hasLabel = this._osdLabel && this._osdLabel.visible;
            const hasTitle = this._osdTitleLabel && this._osdTitleLabel.visible;
            this._osdTextBox.visible = hasLabel || hasTitle;
        }

        if (this._osdBarFill && this._osdBarBg) {
            if (level > -1 && this._showBarPref) {
                this._osdBarBg.visible = true;
                this._lastLevel = level;
                this._syncContentWidth();
            } else {
                this._osdBarBg.visible = false;
                this._lastLevel = -1;
                this._syncContentWidth();
            }
        }

        this._updateContainerHeight();

        this._osdContainer.visible = true;
        this._osdContainer.opacity = 255;

        const displayTime = this._settings.get_int("osd-display-time");
        const fadeDuration = this._settings.get_int("osd-fade-duration");

        if (this._osdTimeoutId) GLib.Source.remove(this._osdTimeoutId);

        this._osdTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            displayTime,
            () => {
                this._osdContainer.ease({
                    opacity: 0,
                    duration: fadeDuration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        this._osdContainer.visible = false;
                    },
                });
                this._osdTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    // Оновлює назву треку "на льоту", поки OSD вже показано (наприклад,
    // коли MPRIS-метадані прийшли вже ПІСЛЯ того, як ми оптимістично
    // показали previous/next/play-pause).
    updateVisibleTitle(title) {
        if (
            this._osdContainer &&
            this._osdContainer.visible &&
            this._osdTitleLabel
        ) {
            this._osdTitleLabel.text = title;
            this._osdTitleLabel.visible = title !== "";

            // Оновлюємо видимість текстового контейнера, як це робиться у show()
            if (this._osdTextBox) {
                const hasLabel = this._osdLabel && this._osdLabel.visible;
                const hasTitle = this._osdTitleLabel.visible;
                this._osdTextBox.visible = hasLabel || hasTitle;
            }

            // Примусово перераховуємо ширину контейнера одразу після зміни тексту
            if (this._syncContentWidth) {
                this._syncContentWidth();
            }
        }
    }

    destroy() {
        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = null;
        }
        if (this._warmUpIdleId) {
            GLib.Source.remove(this._warmUpIdleId);
            this._warmUpIdleId = null;
        }
        if (this._osdTimeoutId) {
            GLib.Source.remove(this._osdTimeoutId);
            this._osdTimeoutId = null;
        }
        if (this._osdContainer) {
            this._osdContainer.destroy();
            this._osdContainer = null;
        }
        if (this._borderProbeActor) {
            this._borderProbeActor.destroy();
            this._borderProbeActor = null;
        }
        this._settings = null;
        this._interfaceSettings = null;
    }
}
