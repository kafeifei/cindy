import type { AdditionalSettingsDomain } from './settingsEditableCatalog.js';
export interface SettingsFieldPresentation { labelKey: string; options?: Array<[string | null, string]>; number?: [number, number, number | 'any']; select?: 'one' | 'chain' | 'many' | 'routes' | 'route' | 'table' | 'effort'; limit?: number; columns?: Record<string, SettingsFieldPresentation>; identity?: string[]; labels?: Record<string, string>; text?: number; nullable?: boolean; choiceSource?: string; merge?: boolean; mergeKeys?: string[] }
/** Labels reuse the client settings vocabulary in all five locales. */
export const additionalSettingsPresentation: Record<AdditionalSettingsDomain, { labelKey: string; brand?: string; tab: string; applies: string; fields: Record<string, SettingsFieldPresentation> }> = {
  "wecomNotifications": {
    "labelKey": "hostSettings.editor.wecomNotifications",
    "fields": {
      "enabled": {
        "labelKey": "hostSettings.editor.wecomNotifications"
      }
    },
    "applies": "immediate",
    "tab": "im-bot"
  },
  "imWorkspaceProviders": {
    "labelKey": "hostSettings.editor.imWorkspaceProviders",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.workingDirectory",
        "select": "table",
        "columns": {
          "providerId": {
            "labelKey": "hostSettings.card.fields.providerId",
            "choiceSource": "providers"
          }
        },
        "identity": [
          "workspaceId"
        ]
      }
    },
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imWorkspaces": {
    "labelKey": "hostSettings.editor.imWorkspaces",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.workingDirectory",
        "select": "table",
        "columns": {
          "modelRoute": {
            "labelKey": "hostSettings.card.fields.modelId",
            "nullable": true,
            "choiceSource": "row",
            "merge": true,
            "mergeKeys": [
              "harness",
              "modelId"
            ]
          },
          "effort": {
            "labelKey": "hostSettings.card.fields.effort",
            "select": "effort"
          },
          "permissionMode": {
            "labelKey": "hostSettings.editor.permissionMode",
            "options": [
              [
                null,
                "hostSettings.card.automatic"
              ],
              [
                "ask",
                "hostSettings.editor.ask"
              ],
              [
                "default",
                "hostSettings.editor.default"
              ],
              [
                "acceptEdits",
                "hostSettings.editor.acceptEdits"
              ],
              [
                "plan",
                "hostSettings.editor.plan"
              ],
              [
                "auto",
                "hostSettings.editor.auto"
              ],
              [
                "bypassPermissions",
                "hostSettings.editor.bypassPermissions"
              ]
            ]
          }
        },
        "identity": [
          "workspaceId"
        ]
      }
    },
    "applies": "next_task",
    "tab": "im-bot"
  },
  "telegramGroups": {
    "labelKey": "hostSettings.editor.telegramGroups",
    "fields": {
      "always": {
        "labelKey": "hostSettings.editor.alwaysGroups",
        "select": "many"
      }
    },
    "applies": "immediate",
    "tab": "im-bot"
  },
  "officialHooks": {
    "labelKey": "hostSettings.editor.officialHooks",
    "fields": {
      "lifecycleAnnouncement": {
        "labelKey": "hostSettings.editor.lifecycleAnnouncement"
      },
      "telegramDefaultWorkspace": {
        "labelKey": "hostSettings.editor.telegramDefaultWorkspace",
        "select": "one"
      },
      "xDefaultWorkspace": {
        "labelKey": "hostSettings.editor.xDefaultWorkspace",
        "select": "one"
      }
    },
    "applies": "immediate",
    "tab": "im-bot"
  },
  "collaboration": {
    "labelKey": "settings.collaboration.title",
    "fields": {
      "workerSoftLimit": {
        "labelKey": "settings.collaboration.workerSoftLimit",
        "number": [
          1,
          20,
          1
        ]
      },
      "workerHardLimit": {
        "labelKey": "settings.collaboration.workerHardLimit",
        "number": [
          1,
          20,
          1
        ]
      },
      "workerIdleReleaseMinutes": {
        "labelKey": "settings.collaboration.idleRelease",
        "number": [
          0,
          120,
          1
        ]
      }
    },
    "applies": "next_task",
    "tab": "general"
  },
  "agentResource": {
    "labelKey": "settings.agentResource.title",
    "fields": {
      "maxConcurrentCommands": {
        "labelKey": "settings.agentResource.maxConcurrent",
        "number": [
          0,
          64,
          1
        ]
      },
      "processPriority": {
        "labelKey": "settings.agentResource.priority",
        "options": [
          [
            "normal",
            "settings.agentResource.priorityOptions.normal"
          ],
          [
            "low",
            "settings.agentResource.priorityOptions.low"
          ],
          [
            "lowest",
            "settings.agentResource.priorityOptions.lowest"
          ]
        ]
      },
      "capToolchainThreads": {
        "labelKey": "settings.agentResource.capThreads"
      }
    },
    "applies": "next_agent_start",
    "tab": "general"
  },
  "gitSafety": {
    "labelKey": "settings.gitSafety.title",
    "fields": {
      "autoSnapshotEnabled": {
        "labelKey": "settings.gitSafety.autoSnapshotTitle"
      }
    },
    "applies": "next_task",
    "tab": "general"
  },
  "memory": {
    "labelKey": "settings.memory.title",
    "fields": {
      "maker": {
        "labelKey": "settings.memory.maker.label"
      },
      "claudeCode": {
        "labelKey": "settings.memory.agents.claude-code.label"
      },
      "codex": {
        "labelKey": "settings.memory.agents.codex.label"
      },
      "pi": {
        "labelKey": "settings.memory.agents.pi.label"
      }
    },
    "applies": "next_agent_start",
    "tab": "personalization"
  },
  "claudeCompaction": {
    "labelKey": "settings.compaction.title",
    "fields": {
      "claudeCodeAutoCompactPct": {
        "labelKey": "settings.compaction.card.label",
        "number": [
          50,
          95,
          1
        ]
      }
    },
    "brand": "Claude Code",
    "applies": "next_agent_start",
    "tab": "personalization"
  },
  "piCompaction": {
    "labelKey": "settings.compaction.title",
    "fields": {
      "piAutoCompactPct": {
        "labelKey": "settings.compaction.card.label",
        "number": [
          50,
          95,
          1
        ]
      }
    },
    "brand": "Pi",
    "applies": "next_agent_start",
    "tab": "personalization"
  },
  "contacts": {
    "labelKey": "settings.contacts.title",
    "fields": {
      "enabled": {
        "labelKey": "settings.contacts.enable.label"
      }
    },
    "applies": "immediate",
    "tab": "personalization"
  },
  "shortcuts": {
    "labelKey": "settings.tabs.shortcuts",
    "fields": {
      "entries": {
        "labelKey": "settings.tabs.shortcuts",
        "select": "table",
        "columns": {
          "code": {
            "labelKey": "hostSettings.editor.key",
            "options": [
              [
                null,
                "hostSettings.editor.disabled"
              ],
              [
                "KeyA",
                "@KeyA"
              ],
              [
                "KeyB",
                "@KeyB"
              ],
              [
                "KeyC",
                "@KeyC"
              ],
              [
                "KeyD",
                "@KeyD"
              ],
              [
                "KeyE",
                "@KeyE"
              ],
              [
                "KeyF",
                "@KeyF"
              ],
              [
                "KeyG",
                "@KeyG"
              ],
              [
                "KeyH",
                "@KeyH"
              ],
              [
                "KeyI",
                "@KeyI"
              ],
              [
                "KeyJ",
                "@KeyJ"
              ],
              [
                "KeyK",
                "@KeyK"
              ],
              [
                "KeyL",
                "@KeyL"
              ],
              [
                "KeyM",
                "@KeyM"
              ],
              [
                "KeyN",
                "@KeyN"
              ],
              [
                "KeyO",
                "@KeyO"
              ],
              [
                "KeyP",
                "@KeyP"
              ],
              [
                "KeyQ",
                "@KeyQ"
              ],
              [
                "KeyR",
                "@KeyR"
              ],
              [
                "KeyS",
                "@KeyS"
              ],
              [
                "KeyT",
                "@KeyT"
              ],
              [
                "KeyU",
                "@KeyU"
              ],
              [
                "KeyV",
                "@KeyV"
              ],
              [
                "KeyW",
                "@KeyW"
              ],
              [
                "KeyX",
                "@KeyX"
              ],
              [
                "KeyY",
                "@KeyY"
              ],
              [
                "KeyZ",
                "@KeyZ"
              ],
              [
                "Digit0",
                "@Digit0"
              ],
              [
                "Digit1",
                "@Digit1"
              ],
              [
                "Digit2",
                "@Digit2"
              ],
              [
                "Digit3",
                "@Digit3"
              ],
              [
                "Digit4",
                "@Digit4"
              ],
              [
                "Digit5",
                "@Digit5"
              ],
              [
                "Digit6",
                "@Digit6"
              ],
              [
                "Digit7",
                "@Digit7"
              ],
              [
                "Digit8",
                "@Digit8"
              ],
              [
                "Digit9",
                "@Digit9"
              ],
              [
                "F1",
                "@F1"
              ],
              [
                "F2",
                "@F2"
              ],
              [
                "F3",
                "@F3"
              ],
              [
                "F4",
                "@F4"
              ],
              [
                "F5",
                "@F5"
              ],
              [
                "F6",
                "@F6"
              ],
              [
                "F7",
                "@F7"
              ],
              [
                "F8",
                "@F8"
              ],
              [
                "F9",
                "@F9"
              ],
              [
                "F10",
                "@F10"
              ],
              [
                "F11",
                "@F11"
              ],
              [
                "F12",
                "@F12"
              ],
              [
                "F13",
                "@F13"
              ],
              [
                "F14",
                "@F14"
              ],
              [
                "F15",
                "@F15"
              ],
              [
                "F16",
                "@F16"
              ],
              [
                "F17",
                "@F17"
              ],
              [
                "F18",
                "@F18"
              ],
              [
                "F19",
                "@F19"
              ],
              [
                "F20",
                "@F20"
              ],
              [
                "F21",
                "@F21"
              ],
              [
                "F22",
                "@F22"
              ],
              [
                "F23",
                "@F23"
              ],
              [
                "F24",
                "@F24"
              ],
              [
                "Numpad0",
                "@Numpad0"
              ],
              [
                "Numpad1",
                "@Numpad1"
              ],
              [
                "Numpad2",
                "@Numpad2"
              ],
              [
                "Numpad3",
                "@Numpad3"
              ],
              [
                "Numpad4",
                "@Numpad4"
              ],
              [
                "Numpad5",
                "@Numpad5"
              ],
              [
                "Numpad6",
                "@Numpad6"
              ],
              [
                "Numpad7",
                "@Numpad7"
              ],
              [
                "Numpad8",
                "@Numpad8"
              ],
              [
                "Numpad9",
                "@Numpad9"
              ],
              [
                "Comma",
                "@Comma"
              ],
              [
                "Period",
                "@Period"
              ],
              [
                "Semicolon",
                "@Semicolon"
              ],
              [
                "Quote",
                "@Quote"
              ],
              [
                "Slash",
                "@Slash"
              ],
              [
                "Backslash",
                "@Backslash"
              ],
              [
                "BracketLeft",
                "@BracketLeft"
              ],
              [
                "BracketRight",
                "@BracketRight"
              ],
              [
                "Backquote",
                "@Backquote"
              ],
              [
                "Minus",
                "@Minus"
              ],
              [
                "Equal",
                "@Equal"
              ],
              [
                "Space",
                "@Space"
              ],
              [
                "Tab",
                "@Tab"
              ],
              [
                "Enter",
                "@Enter"
              ],
              [
                "Escape",
                "@Escape"
              ],
              [
                "Backspace",
                "@Backspace"
              ],
              [
                "Delete",
                "@Delete"
              ],
              [
                "Insert",
                "@Insert"
              ],
              [
                "Home",
                "@Home"
              ],
              [
                "End",
                "@End"
              ],
              [
                "PageUp",
                "@PageUp"
              ],
              [
                "PageDown",
                "@PageDown"
              ],
              [
                "ArrowUp",
                "@ArrowUp"
              ],
              [
                "ArrowDown",
                "@ArrowDown"
              ],
              [
                "ArrowLeft",
                "@ArrowLeft"
              ],
              [
                "ArrowRight",
                "@ArrowRight"
              ],
              [
                "NumpadAdd",
                "@NumpadAdd"
              ],
              [
                "NumpadSubtract",
                "@NumpadSubtract"
              ],
              [
                "NumpadMultiply",
                "@NumpadMultiply"
              ],
              [
                "NumpadDivide",
                "@NumpadDivide"
              ],
              [
                "NumpadDecimal",
                "@NumpadDecimal"
              ],
              [
                "NumpadEnter",
                "@NumpadEnter"
              ]
            ]
          },
          "ctrl": {
            "labelKey": "@Ctrl"
          },
          "alt": {
            "labelKey": "@Alt"
          },
          "shift": {
            "labelKey": "@Shift"
          },
          "meta": {
            "labelKey": "@Super / ⌘"
          }
        },
        "identity": [
          "id"
        ],
        "labels": {
          "toggle-sidebar": "settings.shortcuts.items.toggle-sidebar.label",
          "open-settings": "settings.shortcuts.items.open-settings.label",
          "new-maker": "settings.shortcuts.items.new-maker.label",
          "close-tab-or-window": "settings.shortcuts.items.close-tab-or-window.label",
          "right-tab-prev": "settings.shortcuts.items.right-tab-prev.label",
          "right-tab-next": "settings.shortcuts.items.right-tab-next.label",
          "find-in-page": "settings.shortcuts.items.find-in-page.label",
          "search-in-project": "settings.shortcuts.items.search-in-project.label",
          "save-file": "settings.shortcuts.items.save-file.label",
          "open-terminal": "settings.shortcuts.items.open-terminal.label",
          "zoom-in": "settings.shortcuts.items.zoom-in.label",
          "zoom-out": "settings.shortcuts.items.zoom-out.label",
          "zoom-reset": "settings.shortcuts.items.zoom-reset.label",
          "browser-focus-url": "settings.shortcuts.items.browser-focus-url.label",
          "browser-back": "settings.shortcuts.items.browser-back.label",
          "browser-forward": "settings.shortcuts.items.browser-forward.label",
          "browser-reload": "settings.shortcuts.items.browser-reload.label",
          "cycle-permission-mode": "settings.shortcuts.items.cycle-permission-mode.label",
          "switch-session-1": "settings.shortcuts.items.switch-session-1.label",
          "switch-session-2": "settings.shortcuts.items.switch-session-2.label",
          "switch-session-3": "settings.shortcuts.items.switch-session-3.label",
          "switch-session-4": "settings.shortcuts.items.switch-session-4.label",
          "switch-session-5": "settings.shortcuts.items.switch-session-5.label",
          "switch-session-6": "settings.shortcuts.items.switch-session-6.label",
          "switch-session-7": "settings.shortcuts.items.switch-session-7.label",
          "switch-session-8": "settings.shortcuts.items.switch-session-8.label",
          "switch-session-9": "settings.shortcuts.items.switch-session-9.label"
        }
      }
    },
    "applies": "host_desktop_only",
    "tab": "shortcuts"
  },
  "pluginErrand": {
    "labelKey": "hostSettings.editor.pluginErrand",
    "fields": {
      "routes": {
        "labelKey": "hostSettings.editor.botModels",
        "select": "table",
        "columns": {
          "modelRoute": {
            "labelKey": "hostSettings.card.fields.modelId",
            "choiceSource": "modelRoutes",
            "merge": true
          },
          "effort": {
            "labelKey": "hostSettings.card.fields.effort",
            "select": "effort"
          },
          "fastMode": {
            "labelKey": "hostSettings.card.fields.fast"
          }
        },
        "identity": [
          "ghostId"
        ]
      },
      "permissions": {
        "labelKey": "hostSettings.editor.permissionMode",
        "select": "table",
        "columns": {
          "permissionMode": {
            "labelKey": "hostSettings.editor.permissionMode",
            "options": [
              [
                "plan",
                "hostSettings.editor.plan"
              ],
              [
                "acceptEdits",
                "hostSettings.editor.acceptEdits"
              ],
              [
                "auto",
                "hostSettings.editor.auto"
              ]
            ]
          }
        },
        "identity": [
          "ghostId"
        ]
      },
      "workspaces": {
        "labelKey": "hostSettings.editor.workingDirectory",
        "select": "table",
        "columns": {
          "workspaceId": {
            "labelKey": "hostSettings.editor.workingDirectory",
            "choiceSource": "directories"
          }
        },
        "identity": [
          "ghostId"
        ]
      }
    },
    "applies": "next_task",
    "tab": "ghosts"
  },
  "pluginCindy": {
    "labelKey": "hostSettings.editor.pluginCindy",
    "fields": {
      "inflightLimits": {
        "labelKey": "hostSettings.editor.inflightLimits",
        "select": "table",
        "columns": {
          "limit": {
            "labelKey": "hostSettings.editor.inflightLimits",
            "number": [
              1,
              9007199254740991,
              1
            ]
          }
        },
        "identity": [
          "ghostId"
        ]
      }
    },
    "applies": "next_task",
    "tab": "ghosts"
  },
  "pluginSidebar": {
    "labelKey": "hostSettings.editor.pluginSidebar",
    "fields": {
      "hidden": {
        "labelKey": "hostSettings.editor.pluginSidebar",
        "select": "many"
      }
    },
    "applies": "host_desktop_only",
    "tab": "ghosts"
  },
  "contactsSync": {
    "labelKey": "settings.contacts.sync.label",
    "fields": {
      "deviceSyncEnabled": {
        "labelKey": "settings.contacts.sync.label"
      }
    },
    "applies": "immediate",
    "tab": "personalization"
  },
  "browserBackend": {
    "labelKey": "settings.computerUse.browserBackend.title",
    "fields": {
      "kind": {
        "labelKey": "settings.computerUse.browserBackend.title",
        "options": [
          [
            "external",
            "settings.computerUse.browserBackend.external.title"
          ],
          [
            "rsb-webview",
            "settings.computerUse.browserBackend.rsbWebview.title"
          ]
        ]
      }
    },
    "applies": "next_connection",
    "tab": "computer-use"
  },
  "computerTools": {
    "labelKey": "settings.computerUse.directControl.title",
    "fields": {
      "computer": {
        "labelKey": "settings.computerUse.directControl.title"
      }
    },
    "applies": "next_agent_start",
    "tab": "computer-use"
  },
  "androidTools": {
    "labelKey": "settings.computerUse.android.title",
    "fields": {
      "android": {
        "labelKey": "settings.computerUse.android.title"
      }
    },
    "applies": "next_task",
    "tab": "computer-use"
  },
  "telegramPersona": {
    "labelKey": "settings.telegramBot.persona.title",
    "fields": {
      "botName": {
        "labelKey": "settings.telegramBot.persona.nameLabel"
      },
      "soul": {
        "labelKey": "settings.telegramBot.persona.soulLabel"
      }
    },
    "brand": "Telegram",
    "applies": "next_task",
    "tab": "im-bot"
  },
  "silentEncryptedRetry": {
    "labelKey": "settings.silentEncryptedRetry.cell.label",
    "fields": {
      "enabled": {
        "labelKey": "settings.silentEncryptedRetry.cell.label"
      }
    },
    "applies": "next_task",
    "tab": "personalization"
  },
  "chatEmbedding": {
    "labelKey": "settings.chatEmbedding.cell.label",
    "fields": {
      "enabled": {
        "labelKey": "settings.chatEmbedding.cell.label"
      }
    },
    "applies": "immediate",
    "tab": "personalization"
  },
  "lsp": {
    "labelKey": "settings.lspMode.cell.title",
    "fields": {
      "enabled": {
        "labelKey": "settings.lspMode.cell.title"
      }
    },
    "applies": "next_agent_start",
    "tab": "builtin-tools"
  },
  "privacy": {
    "labelKey": "hostSettings.editor.privacy",
    "fields": {
      "analyticsEnabled": {
        "labelKey": "settings.about.analyticsLabel"
      }
    },
    "applies": "host_desktop_only",
    "tab": "about"
  },
  "diagnostics": {
    "labelKey": "hostSettings.editor.diagnostics",
    "fields": {
      "crashAutoUploadEnabled": {
        "labelKey": "settings.about.logUpload.crashAutoLabel"
      }
    },
    "applies": "immediate",
    "tab": "about"
  },
  "desktopGeneral": {
    "labelKey": "settings.appearance.title",
    "fields": {
      "themeFamilyId": {
        "labelKey": "settings.appearance.title",
        "select": "one"
      },
      "theme": {
        "labelKey": "settings.appearance.modeLabel",
        "options": [
          [
            "system",
            "settings.appearance.theme.system"
          ],
          [
            "light",
            "settings.appearance.theme.light"
          ],
          [
            "dark",
            "settings.appearance.theme.dark"
          ]
        ]
      },
      "locale": {
        "labelKey": "settings.language.label",
        "options": [
          [
            "system",
            "hostSettings.card.automatic"
          ],
          [
            "zh-CN",
            "@简体中文"
          ],
          [
            "zh-TW",
            "@繁體中文"
          ],
          [
            "en",
            "@English"
          ],
          [
            "ja",
            "@日本語"
          ],
          [
            "ko",
            "@한국어"
          ]
        ]
      },
      "sidebarPinnedMode": {
        "labelKey": "settings.appearance.sidebarCardMode.label",
        "options": [
          [
            "text",
            "hostSettings.editor.text"
          ],
          [
            "card",
            "hostSettings.editor.card"
          ],
          [
            "list",
            "hostSettings.editor.list"
          ]
        ]
      },
      "sidebarMainMode": {
        "labelKey": "settings.appearance.sidebarMainListMode.label",
        "options": [
          [
            "text",
            "hostSettings.editor.text"
          ],
          [
            "list",
            "hostSettings.editor.list"
          ]
        ]
      }
    },
    "applies": "host_desktop_only",
    "tab": "general"
  },
  "desktopChat": {
    "labelKey": "hostSettings.editor.desktopChat",
    "fields": {
      "composerSendShortcut": {
        "labelKey": "hostSettings.editor.sendShortcut",
        "options": [
          [
            "enter",
            "hostSettings.editor.enter"
          ],
          [
            "modifier-enter",
            "hostSettings.editor.modifier-enter"
          ]
        ]
      },
      "webLinkOpenPreference": {
        "labelKey": "settings.linkOpen.web.label",
        "options": [
          [
            "external",
            "settings.linkOpen.options.external"
          ],
          [
            "sidebar",
            "settings.linkOpen.options.sidebar"
          ]
        ]
      },
      "localLinkOpenPreference": {
        "labelKey": "settings.linkOpen.local.label",
        "options": [
          [
            "external",
            "settings.linkOpen.options.external"
          ],
          [
            "sidebar",
            "settings.linkOpen.options.sidebar"
          ]
        ]
      },
      "streamFadePreference": {
        "labelKey": "settings.streamFade.label",
        "options": [
          [
            "on",
            "hostSettings.card.on"
          ],
          [
            "off",
            "hostSettings.card.off"
          ]
        ]
      },
      "promptRecommendationEnabled": {
        "labelKey": "settings.promptRecommendation.label"
      },
      "messageNavRailEnabled": {
        "labelKey": "settings.messageNavRail.cell.label"
      }
    },
    "applies": "host_desktop_only",
    "tab": "personalization"
  },
  "desktopNotifications": {
    "labelKey": "settings.notifications.title",
    "fields": {
      "notificationsEnabled": {
        "labelKey": "settings.notifications.sessionDoneLabel"
      },
      "feishuNotificationsEnabled": {
        "labelKey": "settings.notifications.feishuLabel"
      },
      "swallowActivationClick": {
        "labelKey": "settings.windowBehavior.swallowActivationClickLabel"
      },
      "networkDebugEnabled": {
        "labelKey": "hostSettings.editor.networkDebug"
      }
    },
    "applies": "host_desktop_only",
    "tab": "general"
  },
  "linuxWindow": {
    "labelKey": "settings.windowBehavior.title",
    "fields": {
      "linuxCloseBehavior": {
        "labelKey": "settings.windowBehavior.closeBehavior.label",
        "options": [
          [
            null,
            "hostSettings.card.automatic"
          ],
          [
            "quit",
            "settings.windowBehavior.closeBehavior.quit"
          ],
          [
            "minimize",
            "settings.windowBehavior.closeBehavior.minimize"
          ]
        ]
      }
    },
    "applies": "host_desktop_only",
    "tab": "general"
  },
  "telegramBehavior": {
    "labelKey": "settings.telegramBot.behavior.title",
    "fields": {
      "emojiReactions": {
        "labelKey": "settings.telegramBot.behavior.emojiLabel",
        "options": [
          [
            "off",
            "settings.telegramBot.behavior.emojiOption.off"
          ],
          [
            "minimal",
            "settings.telegramBot.behavior.emojiOption.minimal"
          ],
          [
            "expressive",
            "settings.telegramBot.behavior.emojiOption.expressive"
          ]
        ]
      },
      "replyQuoteGroup": {
        "labelKey": "settings.telegramBot.behavior.groupQuoteLabel",
        "options": [
          [
            "off",
            "settings.telegramBot.behavior.quoteOption.off"
          ],
          [
            "first",
            "settings.telegramBot.behavior.quoteOption.first"
          ],
          [
            "all",
            "settings.telegramBot.behavior.quoteOption.all"
          ]
        ]
      },
      "replyQuoteDm": {
        "labelKey": "settings.telegramBot.behavior.dmQuoteLabel",
        "options": [
          [
            "off",
            "settings.telegramBot.behavior.quoteOption.off"
          ],
          [
            "first",
            "settings.telegramBot.behavior.quoteOption.first"
          ]
        ]
      }
    },
    "applies": "immediate",
    "tab": "im-bot"
  },
  "terminal": {
    "labelKey": "settings.terminalShell.title",
    "fields": {
      "defaultShellPref": {
        "labelKey": "settings.terminalShell.card.label",
        "options": [
          [
            "auto",
            "settings.terminalShell.auto"
          ],
          [
            "zsh",
            "@zsh"
          ],
          [
            "bash",
            "@Bash"
          ],
          [
            "fish",
            "@fish"
          ],
          [
            "sh",
            "@sh"
          ],
          [
            "pwsh",
            "@PowerShell"
          ],
          [
            "powershell",
            "@Windows PowerShell"
          ],
          [
            "cmd",
            "@Command Prompt"
          ],
          [
            "gitbash",
            "@Git Bash"
          ],
          [
            "wsl",
            "@WSL"
          ]
        ]
      }
    },
    "applies": "next_connection",
    "tab": "personalization"
  },
  "builtinTools": {
    "labelKey": "settings.builtinTools.title",
    "fields": {
      "feishu_bot": {
        "labelKey": "settings.builtinTools.plugins.feishu_bot.name"
      },
      "wechat": {
        "labelKey": "@WeChat"
      },
      "slack": {
        "labelKey": "@Slack"
      },
      "ssh": {
        "labelKey": "@SSH"
      },
      "docs": {
        "labelKey": "settings.builtinTools.plugins.docs.name"
      },
      "collab": {
        "labelKey": "settings.builtinTools.plugins.collab.name"
      }
    },
    "applies": "next_task",
    "tab": "builtin-tools"
  },
  "workspaceTools": {
    "labelKey": "hostSettings.editor.workspaceTools",
    "fields": {
      "feishu_bot": {
        "labelKey": "settings.builtinTools.plugins.feishu_bot.name"
      },
      "wechat": {
        "labelKey": "@WeChat"
      },
      "slack": {
        "labelKey": "@Slack"
      },
      "ssh": {
        "labelKey": "@SSH"
      },
      "docs": {
        "labelKey": "settings.builtinTools.plugins.docs.name"
      },
      "collab": {
        "labelKey": "settings.builtinTools.plugins.collab.name"
      },
      "browser": {
        "labelKey": "settings.computerUse.browser.title"
      }
    },
    "applies": "next_task",
    "tab": "builtin-tools"
  },
  "browserTools": {
    "labelKey": "settings.computerUse.title",
    "fields": {
      "browser": {
        "labelKey": "settings.computerUse.browser.title"
      }
    },
    "applies": "next_task",
    "tab": "computer-use"
  },
  "subagentModel": {
    "labelKey": "settings.subagentModels.title",
    "fields": {
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "one"
      },
      "codexSmartSubagentRouting": {
        "labelKey": "settings.subagentModels.smartRouting.label"
      }
    },
    "applies": "next_agent_start",
    "tab": "personalization"
  },
  "auxiliaryModel": {
    "labelKey": "settings.auxiliaryModels.title",
    "fields": {
      "models": {
        "labelKey": "settings.auxiliaryModels.title",
        "select": "chain",
        "limit": 3
      }
    },
    "applies": "next_task",
    "tab": "personalization"
  },
  "visionBridge": {
    "labelKey": "settings.visionBridge.title",
    "fields": {
      "enabled": {
        "labelKey": "settings.visionBridge.enableLabel"
      },
      "primary": {
        "labelKey": "settings.visionBridge.backends.primary",
        "select": "one"
      },
      "fallback": {
        "labelKey": "settings.visionBridge.backends.fallback",
        "select": "one"
      },
      "targetModels": {
        "labelKey": "settings.visionBridge.targetModels.label",
        "select": "many"
      }
    },
    "applies": "next_task",
    "tab": "personalization"
  },
  "botModelChain": {
    "labelKey": "hostSettings.editor.botModels",
    "fields": {
      "modelChain": {
        "labelKey": "hostSettings.editor.botModels",
        "select": "routes",
        "limit": 5
      }
    },
    "applies": "next_task",
    "tab": "general"
  },
  "providerNames": {
    "labelKey": "hostSettings.editor.providerNames",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.providerNames",
        "select": "table",
        "columns": {
          "name": {
            "labelKey": "hostSettings.editor.providerNames",
            "text": 128
          }
        },
        "identity": [
          "providerId"
        ]
      }
    },
    "applies": "next_task",
    "tab": "providers"
  },
  "modelPrices": {
    "labelKey": "hostSettings.editor.modelPrices",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.modelPrices",
        "select": "table",
        "columns": {
          "currency": {
            "labelKey": "hostSettings.editor.currency",
            "options": [
              [
                "USD",
                "@USD"
              ],
              [
                "CNY",
                "@CNY"
              ]
            ]
          },
          "inputPerMtok": {
            "labelKey": "hostSettings.editor.inputPrice",
            "number": [
              0,
              1000000000000.0,
              "any"
            ]
          },
          "outputPerMtok": {
            "labelKey": "hostSettings.editor.outputPrice",
            "number": [
              0,
              1000000000000.0,
              "any"
            ]
          },
          "cacheReadPerMtok": {
            "labelKey": "hostSettings.editor.cacheReadPrice",
            "number": [
              0,
              1000000000000.0,
              "any"
            ],
            "nullable": true
          },
          "cacheCreatePerMtok": {
            "labelKey": "hostSettings.editor.cacheWritePrice",
            "number": [
              0,
              1000000000000.0,
              "any"
            ],
            "nullable": true
          }
        }
      }
    },
    "applies": "next_task",
    "tab": "providers"
  },
  "modelVisibility": {
    "labelKey": "hostSettings.editor.modelVisibility",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.modelVisibility",
        "select": "table",
        "columns": {
          "enabled": {
            "labelKey": "hostSettings.editor.visible"
          }
        }
      }
    },
    "applies": "next_task",
    "tab": "providers"
  },
  "modelEngines": {
    "labelKey": "hostSettings.editor.modelEngines",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.modelEngines",
        "select": "table",
        "columns": {}
      }
    },
    "applies": "next_task",
    "tab": "providers"
  },
  "modelFavorites": {
    "labelKey": "hostSettings.editor.modelFavorites",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.modelFavorites",
        "select": "table",
        "columns": {
          "effort": {
            "labelKey": "hostSettings.card.fields.effort",
            "select": "effort"
          },
          "fast": {
            "labelKey": "hostSettings.card.fields.fast"
          }
        }
      }
    },
    "applies": "next_task",
    "tab": "providers"
  },
  "modelContext": {
    "labelKey": "hostSettings.editor.modelContext",
    "fields": {
      "entries": {
        "labelKey": "hostSettings.editor.modelContext",
        "select": "table",
        "columns": {
          "limit": {
            "labelKey": "hostSettings.editor.limit",
            "number": [
              1000,
              100000000,
              1000
            ]
          }
        }
      }
    },
    "applies": "next_task",
    "tab": "providers"
  },
  "modelAccess": {
    "labelKey": "hostSettings.editor.modelAccess",
    "fields": {
      "models": {
        "labelKey": "hostSettings.editor.disabledModels",
        "select": "many"
      },
      "providers": {
        "labelKey": "hostSettings.editor.disabledProviders",
        "select": "many"
      }
    },
    "applies": "next_task",
    "tab": "providers"
  },
  "imGlobal": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imFeishu": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "groupPermissionMode": {
        "labelKey": "hostSettings.editor.groupPermissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "brand": "Feishu / Lark",
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imSlack": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "brand": "Slack",
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imDiscord": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "brand": "Discord",
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imWechat": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "brand": "WeChat",
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imTelegram": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "brand": "Telegram",
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imDingtalk": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "brand": "DingTalk",
    "applies": "next_task",
    "tab": "im-bot"
  },
  "imWecom": {
    "labelKey": "hostSettings.editor.imDefaults",
    "fields": {
      "agentKind": {
        "labelKey": "hostSettings.editor.agentKind",
        "options": [
          [
            "claude-code",
            "@Claude Code"
          ],
          [
            "codex",
            "@Codex"
          ],
          [
            "pi",
            "@Pi"
          ]
        ]
      },
      "permissionMode": {
        "labelKey": "hostSettings.editor.permissionMode",
        "options": [
          [
            "ask",
            "hostSettings.editor.ask"
          ],
          [
            "default",
            "hostSettings.editor.default"
          ],
          [
            "acceptEdits",
            "hostSettings.editor.acceptEdits"
          ],
          [
            "plan",
            "hostSettings.editor.plan"
          ],
          [
            "auto",
            "hostSettings.editor.auto"
          ],
          [
            "bypassPermissions",
            "hostSettings.editor.bypassPermissions"
          ]
        ]
      },
      "claudeCode": {
        "labelKey": "@Claude Code",
        "select": "route"
      },
      "codex": {
        "labelKey": "@Codex",
        "select": "route"
      },
      "pi": {
        "labelKey": "@Pi",
        "select": "route"
      }
    },
    "brand": "WeCom",
    "applies": "next_task",
    "tab": "im-bot"
  }
};
