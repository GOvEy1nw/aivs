import { useCallback, useEffect, useRef, useState } from "react";
import { filePathToFileUrl } from "../../../lib/media-import";
import { getNativeFilePath } from "../../../lib/native-file-path";
import type { GenSpaceMediaInput } from "../types";

export function useGenSpaceMediaInputs() {
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [inputAudio, setInputAudio] = useState<string | null>(null);
  const [imageInputs, setImageInputs] = useState<GenSpaceMediaInput[]>([]);
  const [useAudioTrack, setUseAudioTrack] = useState(true);
  const ownedObjectUrls = useRef(new Set<string>());

  const resolveInputFileUrl = useCallback(
    async (
      file: File,
      syncInputFileToGallery?: (file: File) => Promise<string | null>,
    ): Promise<string | null> => {
      const synced = await syncInputFileToGallery?.(file);
      if (synced) return synced;
      const filePath = getNativeFilePath(file);
      if (filePath) return filePathToFileUrl(filePath);
      const url = URL.createObjectURL(file);
      ownedObjectUrls.current.add(url);
      return url;
    },
    [],
  );

  useEffect(
    () => () => {
      for (const url of ownedObjectUrls.current) URL.revokeObjectURL(url);
      ownedObjectUrls.current.clear();
    },
    [],
  );

  return {
    inputImage,
    setInputImage,
    inputAudio,
    setInputAudio,
    imageInputs,
    setImageInputs,
    useAudioTrack,
    setUseAudioTrack,
    resolveInputFileUrl,
  };
}
