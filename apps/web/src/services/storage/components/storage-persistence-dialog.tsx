"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useStoragePersistence } from "@/services/storage/use-storage-persistence";

export function StoragePersistenceDialog() {
	const { showDialog, onConfirm, onDismiss } = useStoragePersistence();

	return (
		<Dialog open={showDialog} onOpenChange={(open) => !open && onDismiss()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>保护你的本地项目</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<p className="text-base text-muted-foreground">
						当本机存储空间不足时，浏览器可能会自动清理项目数据。
					</p>
					<p className="text-base text-muted-foreground">
						是否允许晴辰剪辑请求持久化存储，降低项目被清理的风险？
					</p>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onDismiss}>
						暂不
					</Button>
					<Button onClick={onConfirm}>允许</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
