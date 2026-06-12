import type { TranscriptionModel, TranscriptionModelId } from "./types";

export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
	{
		id: "whisper-tiny",
		name: "Tiny",
		huggingFaceId: "onnx-community/whisper-tiny",
		description: "最快，准确率较低",
	},
	{
		id: "whisper-small",
		name: "Small",
		huggingFaceId: "onnx-community/whisper-small",
		description: "速度和准确率平衡",
	},
	{
		id: "whisper-medium",
		name: "中",
		huggingFaceId: "onnx-community/whisper-medium",
		description: "准确率更高，速度较慢",
	},
	{
		id: "whisper-large-v3-turbo",
		name: "Large v3 Turbo",
		huggingFaceId: "onnx-community/whisper-large-v3-turbo",
		description: "最佳准确率，需要 WebGPU 才能获得良好性能",
	},
];

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId =
	"whisper-small";
