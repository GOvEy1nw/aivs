import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { GenerateButton } from "./GenerateButton";
import { ImageMediaInputs } from "../image/ImageMediaInputs";
import { ImageEditMediaInputs } from "../image/ImageEditMediaInputs";
import { MusicMediaInputs } from "../music/MusicMediaInputs";
import { VideoMediaInputs } from "../video/VideoMediaInputs";
import { PromptEditor } from "./PromptEditor";
import { GenSpaceModeTabs } from "../GenSpaceModeTabs";
import type { QuickGenWorkflowId } from "../workflows";
import type { ModelProfile } from "../../../types/model-profiles";
import type { GenSpaceMediaInput } from "../types";

vi.mock("../../../contexts/AppSettingsContext", () => ({
  useAppSettings: () => ({
    settings: { uiTheme: "dark" },
    setUiTheme: vi.fn(),
  }),
}));

vi.mock("../../../components/SidebarUtilityButtons", () => ({
  SidebarUtilityButtons: () => null,
}));

afterEach(cleanup);

describe("GenSpace shared controls", () => {
  it("submits on Enter but not Shift+Enter", async () => {
    const submit = vi.fn();
    render(
      <PromptEditor
        value="prompt"
        onChange={vi.fn()}
        onSubmit={submit}
        canSubmit
        disabled={false}
        placeholder="Prompt"
      />,
    );
    const editor = screen.getByRole("textbox");
    editor.focus();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(submit).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("keeps Generate disabled when submission is invalid", async () => {
    const submit = vi.fn();
    render(
      <GenerateButton
        onClick={submit}
        disabled
        loading={false}
        label="Generate"
        icon={null}
      />,
    );
    const button = screen.getByRole("button", { name: "Generate" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it("accepts a gallery image drop with the profile default role", () => {
    const onChange = vi.fn();
    render(
      <ImageMediaInputs
        inputs={[]}
        onChange={onChange}
        policy={{
          supportsImageInputs: true,
          tooltipLabel: "Reference image",
          maxImages: 2,
          defaultRole: "reference_subject",
          roles: [
            {
              role: "reference_subject",
              label: "Subject",
              description: "Reference subject",
              kind: "reference",
            },
          ],
        }}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );
    fireEvent.drop(screen.getByRole("button", { name: "Add media" }), {
      dataTransfer: {
        getData: () =>
          JSON.stringify({
            type: "image",
            url: "file:///C:/reference.png",
          }),
        files: [],
      },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        url: "file:///C:/reference.png",
        role: "reference_subject",
        type: "image",
      }),
    ]);
  });

  it("keeps the selected retouch and reframe tool when assigning an edit source", () => {
    const onImageChange = vi.fn();
    const onToolModeChange = vi.fn();
    const onMaskChange = vi.fn();
    const onOutpaintChange = vi.fn();
    const props = {
      image: null,
      onImageChange,
      references: [],
      onReferencesChange: vi.fn(),
      profile: undefined,
      onToolModeChange,
      mask: { schemaVersion: 1 as const, operations: [] },
      onMaskChange,
      outpaint: {
        aspectMode: "16:9" as const,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      onOutpaintChange,
      disabled: false,
      resolveInputFileUrl: vi.fn(async () => null),
    };
    const { rerender } = render(<ImageEditMediaInputs {...props} toolMode="retouch" />);
    const dropSource = () =>
      fireEvent.drop(document.querySelector("[data-genspace-dropzone]")!, {
        dataTransfer: {
          getData: () => JSON.stringify({ type: "image", url: "file:///C:/source.png" }),
          files: [],
        },
      });

    dropSource();
    rerender(<ImageEditMediaInputs {...props} toolMode="reframe" />);
    dropSource();

    expect(onImageChange).toHaveBeenCalledTimes(2);
    expect(onToolModeChange).not.toHaveBeenCalledWith("edit");
    expect(onMaskChange).toHaveBeenCalledWith(null);
    expect(onOutpaintChange).toHaveBeenCalledWith(null);
  });

  it("accepts Cover Song and Transfer Timbre gallery drops", () => {
    const onInputChange = vi.fn();
    render(
      <MusicMediaInputs
        coverInput={null}
        referenceTimbreInput={null}
        profile={{ music: { supportsCover: true, supportsReferenceTimbre: true } } as ModelProfile}
        coverStrength={100}
        onInputChange={onInputChange}
        onCoverStrengthChange={vi.fn()}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );

    fireEvent.drop(screen.getByRole("button", { name: "Add Cover Song" }), {
      dataTransfer: {
        getData: () =>
          JSON.stringify({
            type: "audio",
            url: "file:///C:/reference.wav",
            duration: 12,
          }),
        files: [],
      },
    });

    expect(onInputChange).toHaveBeenNthCalledWith(1, "cover", {
      url: "file:///C:/reference.wav",
      mediaDuration: 12,
      role: "cover",
    });

    fireEvent.drop(
      screen.getByRole("button", { name: "Add Transfer Timbre" }),
      {
        dataTransfer: {
          getData: () =>
            JSON.stringify({
              type: "audio",
              url: "file:///C:/voice.wav",
              duration: 9,
            }),
          files: [],
        },
      },
    );

    expect(onInputChange).toHaveBeenNthCalledWith(2, "reference-timbre", {
      url: "file:///C:/voice.wav",
      mediaDuration: 9,
      role: "reference-timbre",
    });
  });

  it("shows the usage chip on occupied media and opens its role menu", async () => {
    const onChange = vi.fn();
    render(
      <ImageMediaInputs
        inputs={[
          {
            id: "reference",
            type: "image",
            url: "file:///C:/reference.png",
            role: "reference_subject",
          },
        ]}
        onChange={onChange}
        policy={{
          supportsImageInputs: true,
          tooltipLabel: "Reference image",
          maxImages: 2,
          defaultRole: "reference_subject",
          roles: [
            {
              role: "reference_subject",
              label: "Subject",
              description: "Reference subject",
              kind: "reference",
            },
          ],
        }}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Change Subject usage" }),
    );
    expect(screen.getByText("Image input")).toBeTruthy();
    expect(screen.getAllByText("Subject")).toHaveLength(2);
    expect(screen.getByText("References (1/2)")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Subject" }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows First Frame, Last Frame, and Add media immediately", () => {
    const onChange = vi.fn();
    const profile = {
      inputMedia: {
        supportsImageInputs: true,
        tooltipLabel: "Media inputs",
        maxImages: 4,
        defaultRole: "start_image",
        roles: [
          {
            role: "start_image",
            label: "Start Image",
            description: "Start frame",
            kind: "reference",
          },
          {
            role: "end_image",
            label: "End Image",
            description: "End frame",
            kind: "reference",
          },
        ],
      },
    } as ModelProfile;

    render(
      <VideoMediaInputs
        inputs={[]}
        onChange={onChange}
        profile={profile}
        useAudioTrack
        onUseAudioTrackChange={vi.fn()}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );

    expect(screen.getByTitle("Image 1 (Start)")).toBeTruthy();
    expect(screen.getByTitle("Image 2 (End)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add media" })).toBeTruthy();

    fireEvent.drop(screen.getByTitle("Image 2 (End)").parentElement!, {
      dataTransfer: {
        getData: () =>
          JSON.stringify({
            type: "image",
            url: "file:///C:/last-frame.png",
          }),
        files: [],
      },
    });
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const update = lastCall?.[0] as (
      current: never[],
    ) => Array<{ role: string; url: string }>;
    expect(update([])).toEqual([
      expect.objectContaining({
        role: "end_image",
        url: "file:///C:/last-frame.png",
      }),
    ]);
  });

  it("opens Styles from the video media area", () => {
    const onOpenStyles = vi.fn();
    render(
      <VideoMediaInputs
        inputs={[]}
        onChange={vi.fn()}
        profile={{ inputMedia: { supportsImageInputs: true, roles: [] } } as unknown as ModelProfile}
        useAudioTrack={false}
        onUseAudioTrackChange={vi.fn()}
        resolveInputFileUrl={vi.fn(async () => null)}
        styles={[{ id: "cinematic", displayName: "Cinematic" }]}
        onOpenStyles={onOpenStyles}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Style" }));
    expect(onOpenStyles).toHaveBeenCalledOnce();
  });

  it("keeps H3 references mutually exclusive with frame inputs and hides new FL2VA slots", () => {
    const profile = { id: "minimax_h3_quality", inputMedia: { supportsImageInputs: true } } as ModelProfile;
    const { rerender } = render(
      <VideoMediaInputs
        inputs={[{ id: "ref", alias: "@image1", type: "image", url: "file:///C:/reference.png", role: "reference_image" }]}
        onChange={vi.fn()}
        profile={profile}
        useAudioTrack={false}
        onUseAudioTrackChange={vi.fn()}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );

    const addMedia = screen.getByRole("button", { name: "Add media" });
    const combinedInput = document.querySelector<HTMLInputElement>(
      'input[accept^="image/*,video/*,audio/*"]',
    );
    expect(combinedInput).toBeTruthy();
    const openCombinedInput = vi.spyOn(combinedInput!, "click");
    fireEvent.click(addMedia);
    expect(openCombinedInput).toHaveBeenCalledOnce();

    expect((screen.getByRole("button", { name: "Start image" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Control" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove @image1" })).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Styles unavailable for MiniMax H3",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(
      <VideoMediaInputs
        inputs={[{ id: "start", type: "image", url: "file:///C:/start.png", role: "start_image" }]}
        onChange={vi.fn()}
        profile={profile}
        useAudioTrack={false}
        onUseAudioTrackChange={vi.fn()}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );

    expect((screen.getByRole("button", { name: "Add media" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <VideoMediaInputs
        inputs={[{ id: "restored", type: "audio", url: "file:///C:/control.wav", role: "control_audio" }]}
        onChange={vi.fn()}
        profile={profile}
        useAudioTrack={false}
        onUseAudioTrackChange={vi.fn()}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );
    expect(screen.getByRole("button", { name: "Restored control audio" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove control audio" })).toBeTruthy();
  });

  it("keeps H3 soundtrack selection synchronized through a depth disable and restore", () => {
    const profile = {
      id: "minimax_h3_quality",
      inputMedia: { supportsImageInputs: true },
    } as ModelProfile;
    function H3Inputs() {
      const [inputs, setInputs] = useState<Parameters<typeof VideoMediaInputs>[0]["inputs"]>([
        { id: "one", alias: "@video1", type: "video", url: "file:///C:/one.mp4", role: "reference_video", useAudioTrack: true },
        { id: "two", alias: "@video2", type: "video", url: "file:///C:/two.mp4", role: "reference_video", useAudioTrack: true },
      ]);
      return (
        <VideoMediaInputs
          inputs={inputs}
          onChange={setInputs}
          profile={profile}
          useAudioTrack={false}
          onUseAudioTrackChange={vi.fn()}
          resolveInputFileUrl={vi.fn(async () => null)}
        />
      );
    }

    render(<H3Inputs />);
    fireEvent.click(screen.getByRole("button", { name: "Change @video1 usage" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Depth" }));
    fireEvent.click(screen.getByRole("button", { name: "Change @video1 usage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Audio as Reference" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reference" }));
    fireEvent.click(screen.getByRole("button", { name: "Change @video2 usage" }));

    expect((screen.getByRole("checkbox", { name: "Use Audio as Reference" }) as HTMLInputElement).checked).toBe(false);
  });

  it("replaces the active @ token from the keyboard and opens media add commands", async () => {
    const addMedia = vi.fn();
    function MentionPrompt() {
      const [value, setValue] = useState("Before @ after");
      return <PromptEditor value={value} onChange={setValue} onSubmit={vi.fn()} canSubmit disabled={false} placeholder="Prompt" mediaMentions={[{ alias: "@image1", type: "image", url: "file:///C:/reference.png" }]} onAddMedia={addMedia} />;
    }

    render(<MentionPrompt />);
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(8, 8);
    fireEvent.click(editor);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(editor.value).toBe("Before @image1 after");

    fireEvent.change(editor, { target: { value: "@" } });
    await userEvent.keyboard("{Enter}");
    expect(editor.value).toBe("");
    expect(addMedia).toHaveBeenCalledWith("image");
  });

  it("allocates distinct aliases when H3 reference imports finish out of order", async () => {
    const profile = {
      id: "minimax_h3_quality",
      inputMedia: { supportsImageInputs: true },
    } as ModelProfile;
    const resolvers: Array<(url: string) => void> = [];
    const resolveInputFileUrl = vi.fn(
      () => new Promise<string>((resolve) => resolvers.push(resolve)),
    );
    function H3Inputs() {
      const [inputs, setInputs] = useState<Parameters<typeof VideoMediaInputs>[0]["inputs"]>([]);
      return (
        <VideoMediaInputs
          inputs={inputs}
          onChange={setInputs}
          profile={profile}
          useAudioTrack={false}
          onUseAudioTrackChange={vi.fn()}
          resolveInputFileUrl={resolveInputFileUrl}
        />
      );
    }

    render(<H3Inputs />);
    const combinedInput = document.querySelector<HTMLInputElement>(
      'input[accept^="image/*,video/*,audio/*"]',
    )!;
    fireEvent.change(combinedInput, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    fireEvent.change(combinedInput, {
      target: { files: [new File(["b"], "b.png", { type: "image/png" })] },
    });

    await act(async () => {
      resolvers[1]("file:///C:/b.png");
      await Promise.resolve();
      resolvers[0]("file:///C:/a.png");
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Remove @image1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove @image2" })).toBeTruthy();
  });

  it("keeps video reference trim editors mounted without an update loop", () => {
    const profile = {
      id: "minimax_h3_quality",
      inputMedia: { supportsImageInputs: true },
    } as ModelProfile;
    const ltxProfile = {
      id: "ltx",
      inputMedia: {
        supportsImageInputs: true,
        roles: [
          { role: "start_image", label: "Start", description: "", kind: "reference" },
          { role: "end_image", label: "End", description: "", kind: "reference" },
        ],
      },
    } as ModelProfile;
    function VideoReferenceInputs({ role }: { role: string }) {
      const [inputs, setInputs] = useState<GenSpaceMediaInput[]>([
        {
          id: "video",
          alias: role === "reference_video" ? "@video1" : undefined,
          type: "video" as const,
          url: "file:///C:/reference.mp4",
          role,
        },
      ]);
      return (
        <VideoMediaInputs
          inputs={inputs}
          onChange={setInputs}
          profile={role === "reference_video" ? profile : ltxProfile}
          useAudioTrack={false}
          onUseAudioTrackChange={vi.fn()}
          resolveInputFileUrl={vi.fn(async () => null)}
        />
      );
    }

    const { rerender } = render(<VideoReferenceInputs role="reference_video" />);
    fireEvent.click(screen.getByTitle("Click for actions"));
    fireEvent.click(screen.getByText("Trim"));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();

    rerender(<VideoReferenceInputs key="ltx" role="human_motion" />);
    fireEvent.click(screen.getByTitle("Change Human Motion usage"));
    fireEvent.click(screen.getByText("Trim"));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
  });

  it("removes an occupied media input", async () => {
    const onInputChange = vi.fn();
    render(
      <MusicMediaInputs
        coverInput={{
          url: "file:///C:/reference.wav",
          role: "cover",
        }}
        referenceTimbreInput={null}
        profile={{ music: { supportsCover: true } } as ModelProfile}
        coverStrength={100}
        onInputChange={onInputChange}
        onCoverStrengthChange={vi.fn()}
        resolveInputFileUrl={vi.fn(async () => null)}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Cover Song actions" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Cover Song" }),
    );

    expect(onInputChange).toHaveBeenCalledWith("cover", null);
  });

  it("enables favourite reordering only from its context menu", async () => {
    const selectWorkflow = vi.fn();
    const toggleFavourite = vi.fn();
    let resolveConfirm: (() => void) | undefined;
    const confirmFavouriteOrder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    function FavouriteTabs() {
      const [favourites, setFavourites] = useState<QuickGenWorkflowId[]>([
        "image:create",
      ]);
      return (
        <>
          <button type="button" onClick={() => setFavourites(["image:create"])}>
            Restore favourite
          </button>
          <GenSpaceModeTabs
            mode="image"
            onChange={vi.fn()}
            favouriteIds={favourites}
            onSelectWorkflow={selectWorkflow}
            onToggleFavourite={(workflowId) => {
              toggleFavourite(workflowId);
              setFavourites((current) =>
                current.filter((favouriteId) => favouriteId !== workflowId),
              );
            }}
            onReorderFavourite={vi.fn()}
            onConfirmReorder={confirmFavouriteOrder}
          />
        </>
      );
    }

    render(<FavouriteTabs />);

    const favourite = screen.getAllByRole("button", {
      name: "Open favourite Generate",
    })[0] as HTMLButtonElement;
    expect(favourite.draggable).toBe(false);

    favourite.focus();
    fireEvent.keyDown(favourite, { key: "F10", shiftKey: true });
    await act(
      () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
    );
    const removeAction = screen.getByRole("menuitem", { name: "Remove" });
    expect(document.activeElement).toBe(removeAction);
    fireEvent.keyDown(removeAction, { key: "Escape" });
    await act(
      () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
    );
    expect(document.activeElement).toBe(favourite);

    fireEvent.contextMenu(favourite, { clientX: 80, clientY: 80 });
    await userEvent.click(screen.getByRole("menuitem", { name: "Re-order" }));
    expect(favourite.draggable).toBe(true);
    const doneButton = screen.getByRole("button", {
      name: "Done reordering favourites",
    }) as HTMLButtonElement;
    fireEvent.click(doneButton);
    expect(confirmFavouriteOrder).toHaveBeenCalledOnce();
    expect(doneButton.disabled).toBe(true);
    await act(async () => {
      resolveConfirm?.();
      await Promise.resolve();
    });
    expect(favourite.draggable).toBe(false);

    fireEvent.contextMenu(favourite, { clientX: 80, clientY: 80 });
    await userEvent.click(screen.getByRole("menuitem", { name: "Re-order" }));
    expect(favourite.draggable).toBe(true);
    fireEvent.contextMenu(favourite, { clientX: 80, clientY: 80 });
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(toggleFavourite).toHaveBeenCalledWith("image:create");
    expect(
      screen.queryByRole("button", { name: "Done reordering favourites" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Restore favourite" }));
    expect(
      (screen.getByRole("button", { name: "Open favourite Generate" }) as HTMLButtonElement)
        .draggable,
    ).toBe(false);
    expect(selectWorkflow).not.toHaveBeenCalled();
  });
});
