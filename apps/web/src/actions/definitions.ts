import type { ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "./types";

export type TActionCategory =
	| "播放"
	| "导航"
	| "编辑"
	| "选择"
	| "历史"
	| "时间线"
	| "控制"
	| "素材";

export interface TActionBaseDefinition {
	description: string;
	category: TActionCategory;
	args?: Record<string, unknown>;
}

export interface TActionDefinition extends TActionBaseDefinition {
	defaultShortcuts?: readonly ShortcutKey[];
}

export const ACTIONS = {
	"toggle-play": {
		description: "播放/暂停",
		category: "播放",
	},
	"stop-playback": {
		description: "停止播放",
		category: "播放",
	},
	"seek-forward": {
		description: "前进 1 秒",
		category: "播放",
		args: { seconds: "number" },
	},
	"seek-backward": {
		description: "后退 1 秒",
		category: "播放",
		args: { seconds: "number" },
	},
	"frame-step-forward": {
		description: "前进一帧",
		category: "导航",
	},
	"frame-step-backward": {
		description: "后退一帧",
		category: "导航",
	},
	"jump-forward": {
		description: "前进 5 秒",
		category: "导航",
		args: { seconds: "number" },
	},
	"jump-backward": {
		description: "后退 5 秒",
		category: "导航",
		args: { seconds: "number" },
	},
	"goto-start": {
		description: "跳到时间线开头",
		category: "导航",
	},
	"goto-end": {
		description: "跳到时间线结尾",
		category: "导航",
	},
	split: {
		description: "在播放头处分割元素",
		category: "编辑",
	},
	"split-left": {
		description: "分割并删除左侧",
		category: "编辑",
	},
	"split-right": {
		description: "分割并删除右侧",
		category: "编辑",
	},
	"delete-selected": {
		description: "删除当前选择",
		category: "编辑",
	},
	"copy-selected": {
		description: "复制选中元素",
		category: "编辑",
	},
	"paste-copied": {
		description: "粘贴到播放头",
		category: "编辑",
	},
	"toggle-snapping": {
		description: "切换吸附",
		category: "编辑",
	},
	"toggle-ripple-editing": {
		description: "切换波纹编辑",
		category: "编辑",
	},
	"toggle-source-audio": {
		description: "提取或恢复源音频",
		category: "编辑",
	},
	"select-all": {
		description: "选择所有元素",
		category: "选择",
	},
	"cancel-interaction": {
		description: "取消当前操作",
		category: "控制",
	},
	"deselect-all": {
		description: "取消选择所有元素",
		category: "选择",
	},
	"duplicate-selected": {
		description: "复制选中元素",
		category: "选择",
	},
	"toggle-elements-muted-selected": {
		description: "静音/取消静音选中元素",
		category: "选择",
	},
	"toggle-elements-visibility-selected": {
		description: "显示/隐藏选中元素",
		category: "选择",
	},
	"toggle-bookmark": {
		description: "在播放头切换书签",
		category: "时间线",
	},
	undo: {
		description: "撤销",
		category: "历史",
	},
	redo: {
		description: "重做",
		category: "历史",
	},
	"remove-media-asset": {
		description: "移除媒体素材",
		category: "素材",
		args: { projectId: "string", assetId: "string" },
	},
	"remove-media-assets": {
		description: "移除媒体素材",
		category: "素材",
		args: { projectId: "string", assetIds: "string[]" },
	},
} as const satisfies Record<string, TActionBaseDefinition>;

export type TAction = keyof typeof ACTIONS;

const ACTIONS_REQUIRING_ARGS = new Set<TAction>([
	"remove-media-asset",
	"remove-media-assets",
]);

export function isActionWithOptionalArgs(
	value: string,
): value is TActionWithOptionalArgs {
	return value in ACTIONS && !ACTIONS_REQUIRING_ARGS.has(value as TAction);
}

const ACTION_DEFAULT_SHORTCUTS = [
	["toggle-play", ["space", "k"]],
	["seek-forward", ["l"]],
	["seek-backward", ["j"]],
	["frame-step-forward", ["right"]],
	["frame-step-backward", ["left"]],
	["jump-forward", ["shift+right"]],
	["jump-backward", ["shift+left"]],
	["goto-start", ["home", "enter"]],
	["goto-end", ["end"]],
	["split", ["s"]],
	["split-left", ["q"]],
	["split-right", ["w"]],
	["delete-selected", ["backspace", "delete"]],
	["copy-selected", ["ctrl+c"]],
	["paste-copied", ["ctrl+v"]],
	["toggle-snapping", ["n"]],
	["select-all", ["ctrl+a"]],
	["cancel-interaction", ["escape"]],
	["duplicate-selected", ["ctrl+d"]],
	["undo", ["ctrl+z"]],
	["redo", ["ctrl+shift+z", "ctrl+y"]],
] as const satisfies ReadonlyArray<
	readonly [TActionWithOptionalArgs, readonly ShortcutKey[]]
>;

const ACTION_DEFAULT_SHORTCUTS_BY_ACTION = new Map<
	TAction,
	readonly ShortcutKey[]
>(ACTION_DEFAULT_SHORTCUTS);

export function getActionDefinition({
	action,
}: {
	action: TAction;
}): TActionDefinition {
	return {
		...ACTIONS[action],
		defaultShortcuts: ACTION_DEFAULT_SHORTCUTS_BY_ACTION.get(action),
	};
}

export function getDefaultShortcuts(): Map<
	ShortcutKey,
	TActionWithOptionalArgs
> {
	const shortcuts = new Map<ShortcutKey, TActionWithOptionalArgs>();

	for (const [action, defaultShortcuts] of ACTION_DEFAULT_SHORTCUTS) {
		for (const shortcut of defaultShortcuts) {
			shortcuts.set(shortcut, action);
		}
	}

	return shortcuts;
}
