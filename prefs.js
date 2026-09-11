import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Допоміжні функції для імпорту / експорту / скидання налаштувань.
// Працюють узагальнено через схему GSettings, тому не залежать
// від конкретного переліку ключів.

function buildSettingsObject(settings) {
    const keys = settings.settings_schema.list_keys();
    const obj = {};
    for (const key of keys) {
        obj[key] = settings.get_value(key).deep_unpack();
    }
    return obj;
}

function applySettingsObject(settings, obj) {
    const schema = settings.settings_schema;
    settings.delay();
    for (const key of Object.keys(obj)) {
        if (!schema.has_key(key)) continue;
        try {
            const valueType = schema.get_key(key).get_value_type();
            const variant = new GLib.Variant(valueType.dup_string(), obj[key]);
            settings.set_value(key, variant);
        } catch (e) {
            logError(e, `Не вдалося застосувати ключ "${key}"`);
        }
    }
    settings.apply();
}

function resetAllSettings(settings) {
    const keys = settings.settings_schema.list_keys();
    for (const key of keys) {
        settings.reset(key);
    }
}

export default class EdgeControlPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Створюємо дві окремі сторінки (вкладки)
        const pageStyle = new Adw.PreferencesPage({
            title: "Стиль OSD",
            icon_name: "preferences-desktop-appearance-symbolic",
        });

        const pageAdvanced = new Adw.PreferencesPage({
            title: "Додатково",
            icon_name: "preferences-system-details-symbolic",
        });

        // Допоміжні функції

        // Уніфікований рядок з кнопкою-лічильником (як у Media Label):
        // кнопка показує число, значення змінюється прокруткою колеса миші.
        const addSpinRow = (
            group,
            title,
            key,
            lower,
            upper,
            step = 1,
            digits = 0,
        ) => {
            const row = new Adw.ActionRow({ title });

            const formatValue = (val) =>
                digits > 0 ? val.toFixed(digits) : Math.round(val).toString();

            const getValue = () =>
                digits > 0 ? settings.get_double(key) : settings.get_int(key);

            const setValue = (val) => {
                if (digits > 0) {
                    settings.set_double(key, val);
                } else {
                    settings.set_int(key, val);
                }
            };

            const clampValue = (value) =>
                Math.max(lower, Math.min(upper, value));

            const button = new Gtk.Button({
                label: formatValue(getValue()),
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags: Gtk.EventControllerScrollFlags.VERTICAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, _dx, dy) => {
                const current = getValue();
                let next = dy < 0 ? current + step : current - step;
                next = clampValue(next);
                next =
                    digits > 0
                        ? parseFloat(next.toFixed(digits))
                        : Math.round(next);
                setValue(next);
                button.label = formatValue(next);
                return true;
            });
            button.add_controller(scrollCtrl);

            settings.connect(`changed::${key}`, () => {
                button.label = formatValue(getValue());
            });

            row.add_suffix(button);
            row.activatable_widget = button;
            group.add(row);
            return button;
        };

        // ==========================================
        // ВКЛАДКА 1: СТИЛЬ OSD
        // ==========================================

        // --- ГРУПА: СТИЛЬ OSD ---
        const styleGroup = new Adw.PreferencesGroup({
            title: "Стиль контейнера",
        });
        pageStyle.add(styleGroup);

        addSpinRow(styleGroup, "Висота", "osd-height", 60, 120, 1);
        addSpinRow(
            styleGroup,
            "Максимальна ширина",
            "osd-max-width",
            200,
            800,
            10,
        );
        addSpinRow(styleGroup, "Радіус кутів", "osd-border-radius", 0, 100);

        // --- ГРУПА: ВІДСТУПИ ---
        const paddingGroup = new Adw.PreferencesGroup({
            title: "Відступи",
        });
        pageStyle.add(paddingGroup);

        const paddingExpander = new Adw.ExpanderRow({
            title: "Відступи іконки",
        });
        paddingGroup.add(paddingExpander);

        // ExpanderRow додає дочірні рядки через add_row(), а не add(),
        // тому передаємо в addSpinRow невеликий об'єкт-обгортку.
        const paddingExpanderTarget = {
            add: (row) => paddingExpander.add_row(row),
        };

        addSpinRow(paddingExpanderTarget, "Зверху", "osd-padding-top", 0, 100);
        addSpinRow(
            paddingExpanderTarget,
            "Справа",
            "osd-padding-right",
            0,
            100,
        );
        addSpinRow(
            paddingExpanderTarget,
            "Знизу",
            "osd-padding-bottom",
            0,
            100,
        );
        addSpinRow(paddingExpanderTarget, "Зліва", "osd-padding-left", 0, 100);

        const fontPaddingExpander = new Adw.ExpanderRow({
            title: "Відступи шрифту",
        });
        paddingGroup.add(fontPaddingExpander);

        const fontPaddingExpanderTarget = {
            add: (row) => fontPaddingExpander.add_row(row),
        };

        addSpinRow(
            fontPaddingExpanderTarget,
            "Зверху",
            "osd-font-padding-top",
            0,
            100,
        );
        addSpinRow(
            fontPaddingExpanderTarget,
            "Справа",
            "osd-font-padding-right",
            0,
            100,
        );
        addSpinRow(
            fontPaddingExpanderTarget,
            "Знизу",
            "osd-font-padding-bottom",
            0,
            100,
        );
        addSpinRow(
            fontPaddingExpanderTarget,
            "Зліва",
            "osd-font-padding-left",
            0,
            100,
        );

        const barPaddingExpander = new Adw.ExpanderRow({
            title: "Відступи смужки прогресу",
        });
        paddingGroup.add(barPaddingExpander);

        const barPaddingExpanderTarget = {
            add: (row) => barPaddingExpander.add_row(row),
        };

        addSpinRow(
            barPaddingExpanderTarget,
            "Зверху",
            "osd-bar-padding-top",
            0,
            100,
        );
        addSpinRow(
            barPaddingExpanderTarget,
            "Справа",
            "osd-bar-padding-right",
            0,
            100,
        );
        addSpinRow(
            barPaddingExpanderTarget,
            "Знизу",
            "osd-bar-padding-bottom",
            0,
            100,
        );
        addSpinRow(
            barPaddingExpanderTarget,
            "Зліва",
            "osd-bar-padding-left",
            0,
            100,
        );

        // --- ГРУПА: СИМВОЛ «%» ---
        const symbolGroup = new Adw.PreferencesGroup({
            title: "Символ «%»",
        });
        pageStyle.add(symbolGroup);

        const percentSwitch = new Adw.SwitchRow({
            title: "Показувати символ «%»",
        });
        settings.bind(
            "show-percent-symbol",
            percentSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        symbolGroup.add(percentSwitch);

        // --- ГРУПА: СМУЖКА ПРОГРЕСУ ---
        const barGroup = new Adw.PreferencesGroup({
            title: "Смужка прогресу",
        });
        pageStyle.add(barGroup);

        const barSwitch = new Adw.SwitchRow({
            title: "Показувати смужку прогресу",
        });
        settings.bind(
            "show-osd-bar",
            barSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        barGroup.add(barSwitch);

        addSpinRow(barGroup, "Висота", "osd-bar-height", 2, 50);
        addSpinRow(barGroup, "Радіус кутів", "osd-bar-radius", 0, 50);

        // --- ГРУПА: РАМКА OSD ---
        const borderGroup = new Adw.PreferencesGroup({
            title: "Рамка контейнера",
        });
        pageStyle.add(borderGroup);

        const borderSwitch = new Adw.SwitchRow({
            title: "Показувати рамку",
        });
        settings.bind(
            "osd-border-show",
            borderSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        borderGroup.add(borderSwitch);

        addSpinRow(borderGroup, "Товщина", "osd-border-width", 1, 10);

        // ==========================================
        // ВКЛАДКА 2: ДОДАТКОВО
        // ==========================================

        // --- ГРУПА: ПОЗИЦІЯ ТА ВІДСТУП ---
        const positionGroup = new Adw.PreferencesGroup({
            title: "Позиція та відступ",
        });
        pageAdvanced.add(positionGroup);

        const positionValues = [
            "top-left",
            "center-left",
            "bottom-left",
            "top-center",
            "center",
            "bottom-center",
            "top-right",
            "center-right",
            "bottom-right",
        ];

        const positionLabels = [
            "Зліва зверху",
            "Зліва по центру",
            "Зліва знизу",
            "По центру зверху",
            "По центру",
            "По центру знизу",
            "Справа зверху",
            "Справа по центру",
            "Справа знизу",
        ];

        const posRow = new Adw.ActionRow({
            title: "Позиція",
        });
        const posDropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(positionLabels),
            valign: Gtk.Align.CENTER,
        });

        const currentPos = settings.get_string("osd-position");
        posDropdown.selected =
            positionValues.indexOf(currentPos) !== -1
                ? positionValues.indexOf(currentPos)
                : 4;

        posDropdown.connect("notify::selected", () => {
            settings.set_string(
                "osd-position",
                positionValues[posDropdown.selected],
            );
        });

        settings.connect("changed::osd-position", () => {
            const val = settings.get_string("osd-position");
            const idx = positionValues.indexOf(val);
            if (idx >= 0 && idx !== posDropdown.selected) {
                posDropdown.selected = idx;
            }
        });

        posRow.add_suffix(posDropdown);
        positionGroup.add(posRow);

        addSpinRow(
            positionGroup,
            "Відступ від краю",
            "osd-edge-margin",
            10,
            100,
            5,
        );

        // --- ГРУПА: ЧАС ВІДОБРАЖЕННЯ ---
        const timeGroup = new Adw.PreferencesGroup({
            title: "Тривалість",
        });
        pageAdvanced.add(timeGroup);

        addSpinRow(
            timeGroup,
            "Тривалість відображення",
            "osd-display-time",
            500,
            5000,
            50,
        );
        addSpinRow(
            timeGroup,
            "Тривалість зникнення",
            "osd-fade-duration",
            100,
            2000,
            50,
        );

        const hideOnHoverRow = new Adw.SwitchRow({
            title: "Ховати OSD при контакті з курсором",
        });
        settings.bind(
            "osd-hide-on-hover",
            hideOnHoverRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        timeGroup.add(hideOnHoverRow);

        // --- ГРУПА: КРОК ПРОКРУТКИ ---
        const scrollGroup = new Adw.PreferencesGroup({
            title: "Крок прокрутки",
        });
        pageAdvanced.add(scrollGroup);

        addSpinRow(scrollGroup, "Крок гучності", "volume-step", 1, 100, 1, 0);

        addSpinRow(
            scrollGroup,
            "Крок яскравості",
            "brightness-step",
            1,
            100,
            1,
            0,
        );

        // --- ГРУПА: АВТОМАТИЧНІ РІВНІ ГУЧНОСТІ ТА ЯСКРАВОСТІ ---
        const autoLevelsGroup = new Adw.PreferencesGroup({
            title: "Автоматичні рівні гучності та яскравості",
        });
        pageAdvanced.add(autoLevelsGroup);

        // Кнопка-лічильник з іконкою зліва та числовим значенням справа
        // (той самий принцип прокрутки колесом миші, що й у addSpinRow).
        const addIconSpinButton = (
            key,
            iconName,
            lower = 0,
            upper = 100,
            step = 5,
        ) => {
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
            });
            const icon = new Gtk.Image({ icon_name: iconName });
            const label = new Gtk.Label({
                label: settings.get_int(key).toString(),
            });
            box.append(icon);
            box.append(label);

            const button = new Gtk.Button({
                child: box,
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const clampValue = (value) =>
                Math.max(lower, Math.min(upper, value));

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags: Gtk.EventControllerScrollFlags.VERTICAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, _dx, dy) => {
                const current = settings.get_int(key);
                const next = clampValue(
                    dy < 0 ? current + step : current - step,
                );
                settings.set_int(key, next);
                label.label = next.toString();
                return true;
            });
            button.add_controller(scrollCtrl);

            settings.connect(`changed::${key}`, () => {
                label.label = settings.get_int(key).toString();
            });

            return button;
        };

        // Будує один ExpanderRow "Відновлення гучності"/"Відновлення
        // яскравості" за єдиним принципом: рядок-перемикач "Останнє
        // значення" (вимикає рядок "День / Ніч", коли активний) + рядок
        // "День / Ніч" із двома кнопками-регуляторами.
        const addRestoreExpander = (title, prefix) => {
            const expander = new Adw.ExpanderRow({ title });
            autoLevelsGroup.add(expander);

            const lastValueRow = new Adw.SwitchRow({
                title: "Останнє значення",
            });
            settings.bind(
                `${prefix}-restore-last-value`,
                lastValueRow,
                "active",
                Gio.SettingsBindFlags.DEFAULT,
            );
            expander.add_row(lastValueRow);

            const dayNightRow = new Adw.ActionRow({
                title: "День / Ніч",
            });

            const dayNightBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER,
            });
            const dayButton = addIconSpinButton(
                `${prefix}-restore-day`,
                "weather-clear-symbolic",
            );
            const nightButton = addIconSpinButton(
                `${prefix}-restore-night`,
                "weather-clear-night-symbolic",
            );
            dayNightBox.append(dayButton);
            dayNightBox.append(nightButton);

            dayNightRow.add_suffix(dayNightBox);
            expander.add_row(dayNightRow);

            // Рядок "День / Ніч" неактивний, поки увімкнено "Останнє значення"
            const updateDayNightSensitivity = () => {
                dayNightRow.sensitive = !settings.get_boolean(
                    `${prefix}-restore-last-value`,
                );
            };
            updateDayNightSensitivity();
            settings.connect(
                `changed::${prefix}-restore-last-value`,
                updateDayNightSensitivity,
            );
        };

        addRestoreExpander("Відновлення гучності", "volume");
        addRestoreExpander("Відновлення яскравості", "brightness");

        // --- ГРУПА: НАЛАШТУВАННЯ ЗОНИ ЧУТЛИВОСТІ ---
        const edgeGroup = new Adw.PreferencesGroup({
            title: "Зона чутливості",
        });
        pageAdvanced.add(edgeGroup);

        const showRow = new Adw.SwitchRow({
            title: "Показувати зону чутливості",
        });
        settings.bind(
            "edge-show-indicator",
            showRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        edgeGroup.add(showRow);

        addSpinRow(edgeGroup, "Висота", "edge-height", 10, 100, 5);
        addSpinRow(edgeGroup, "Ширина", "edge-width", 1, 50, 1);

        // --- ГРУПА: НАЛАШТУВАННЯ ---
        const settingsGroup = new Adw.PreferencesGroup({
            title: "Налаштування",
        });
        pageAdvanced.add(settingsGroup);

        const settingsActionsRow = new Adw.ActionRow({
            title: "Дії з налаштуваннями",
        });
        settingsGroup.add(settingsActionsRow);

        const actionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            homogeneous: true,
            valign: Gtk.Align.CENTER,
        });

        const importButton = new Gtk.Button({ label: "Імпорт" });
        const exportButton = new Gtk.Button({ label: "Експорт" });
        const resetButton = new Gtk.Button({ label: "Скинути" });
        resetButton.add_css_class("destructive-action");

        actionsBox.append(importButton);
        actionsBox.append(exportButton);
        actionsBox.append(resetButton);

        settingsActionsRow.add_suffix(actionsBox);

        // Спільний фільтр для .json файлів
        const makeJsonFilter = () => {
            const filter = new Gtk.FileFilter();
            filter.set_name("JSON файли");
            filter.add_pattern("*.json");
            filter.add_mime_type("application/json");
            const filterList = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filterList.append(filter);
            return filterList;
        };

        // Показ простого повідомлення про помилку/успіх
        const showInfoDialog = (heading, body) => {
            const dialog = new Adw.MessageDialog({
                heading,
                body,
                transient_for: window,
                modal: true,
            });
            dialog.add_response("ok", "Гаразд");
            dialog.set_default_response("ok");
            dialog.set_close_response("ok");
            dialog.present();
        };

        // --- ЕКСПОРТ ---
        exportButton.connect("clicked", () => {
            const dialog = new Gtk.FileDialog({
                title: "Експортувати налаштування",
                initial_name: "edge-control-settings.json",
                filters: makeJsonFilter(),
            });

            dialog.save(window, null, (dlg, res) => {
                let file;
                try {
                    file = dlg.save_finish(res);
                } catch (e) {
                    // Користувач скасував вибір файлу — нічого не робимо
                    return;
                }
                if (!file) return;

                try {
                    const data = buildSettingsObject(settings);
                    const jsonStr = JSON.stringify(data, null, 2);
                    const bytes = new GLib.Bytes(
                        new TextEncoder().encode(jsonStr),
                    );
                    file.replace_contents_bytes_async(
                        bytes,
                        null,
                        false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION,
                        null,
                        (f, asyncRes) => {
                            try {
                                f.replace_contents_finish(asyncRes);
                            } catch (e) {
                                logError(e, "Помилка запису файлу");
                                showInfoDialog(
                                    "Помилка експорту",
                                    "Не вдалося зберегти файл налаштувань.",
                                );
                            }
                        },
                    );
                } catch (e) {
                    logError(e, "Помилка експорту налаштувань");
                    showInfoDialog(
                        "Помилка експорту",
                        "Не вдалося сформувати файл налаштувань.",
                    );
                }
            });
        });

        // --- ІМПОРТ ---
        importButton.connect("clicked", () => {
            const dialog = new Gtk.FileDialog({
                title: "Імпортувати налаштування",
                filters: makeJsonFilter(),
            });

            dialog.open(window, null, (dlg, res) => {
                let file;
                try {
                    file = dlg.open_finish(res);
                } catch (e) {
                    // Користувач скасував вибір файлу — нічого не робимо
                    return;
                }
                if (!file) return;

                file.load_contents_async(null, (f, asyncRes) => {
                    try {
                        const [, contents] = f.load_contents_finish(asyncRes);
                        const jsonStr = new TextDecoder().decode(contents);
                        const data = JSON.parse(jsonStr);
                        applySettingsObject(settings, data);
                    } catch (e) {
                        logError(e, "Помилка читання файлу");
                        showInfoDialog(
                            "Помилка імпорту",
                            "Не вдалося прочитати файл налаштувань. Переконайтесь, що це коректний JSON-файл, створений цим розширенням.",
                        );
                    }
                });
            });
        });

        // --- СКИНУТИ ---
        resetButton.connect("clicked", () => {
            const confirmDialog = new Adw.MessageDialog({
                heading: "Скинути налаштування?",
                body: "Усі налаштування розширення будуть повернуті до значень за замовчуванням. Цю дію не можна скасувати.",
                transient_for: window,
                modal: true,
            });
            confirmDialog.add_response("cancel", "Скасувати");
            confirmDialog.add_response("reset", "Скинути");
            confirmDialog.set_response_appearance(
                "reset",
                Adw.ResponseAppearance.DESTRUCTIVE,
            );
            confirmDialog.set_default_response("cancel");
            confirmDialog.set_close_response("cancel");
            confirmDialog.connect("response", (_dlg, response) => {
                if (response === "reset") {
                    resetAllSettings(settings);
                }
            });
            confirmDialog.present();
        });

        // Додаємо обидві вкладки до головного вікна
        window.add(pageStyle);
        window.add(pageAdvanced);
    }
}
