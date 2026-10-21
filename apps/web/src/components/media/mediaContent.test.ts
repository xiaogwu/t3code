import { afterEach, expect, it, vi } from "vite-plus/test";

import { readMediaPng } from "./mediaContent";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("decodes image data URLs locally instead of fetching them", async () => {
  const fetchSpy = vi.fn().mockRejectedValue(new TypeError("blocked by connect-src"));
  vi.stubGlobal("fetch", fetchSpy);
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
  const dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;

  const blob = await readMediaPng(dataUrl);

  expect(blob.type).toBe("image/png");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("rejects malformed data URLs with a plain-language error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("blocked by connect-src")));

  await expect(readMediaPng("data:image/png;base64")).rejects.toThrow(
    "The image data is malformed. Try saving it instead.",
  );
  await expect(readMediaPng("data:image/png;base64,***")).rejects.toThrow(
    "The image data is malformed. Try saving it instead.",
  );
});
