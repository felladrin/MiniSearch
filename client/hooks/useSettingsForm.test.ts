import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsPubSub } from "@/modules/pubSub";
import { defaultSettings } from "@/modules/settings";
import { useSettingsForm } from "./useSettingsForm";

const [updateSettings, onSettingsChange, getSettings] = settingsPubSub;

describe("useSettingsForm", () => {
  beforeEach(() => {
    updateSettings(defaultSettings);
  });

  it("holds only the keys it was given", () => {
    const { result } = renderHook(() =>
      useSettingsForm(["enterToSubmit", "enableTextSearch"]),
    );

    expect(result.current.values).toEqual({
      enterToSubmit: true,
      enableTextSearch: true,
    });
  });

  it("writes a changed key into the settings", () => {
    const { result } = renderHook(() => useSettingsForm(["enterToSubmit"]));

    act(() => result.current.setFieldValue("enterToSubmit", false));

    expect(getSettings()).toEqual({ ...defaultSettings, enterToSubmit: false });
  });

  it("keeps a value another writer changed after the form was opened", () => {
    const { result } = renderHook(() => useSettingsForm(["enterToSubmit"]));

    act(() =>
      updateSettings({
        ...getSettings(),
        enableTextSearch: false,
        wllamaModelId: "another-model",
      }),
    );
    act(() => result.current.setFieldValue("enterToSubmit", false));

    expect(getSettings()).toEqual({
      ...defaultSettings,
      enableTextSearch: false,
      wllamaModelId: "another-model",
      enterToSubmit: false,
    });
  });

  it("writes every key of one change in a single update", () => {
    updateSettings({
      ...defaultSettings,
      textToSpeechEngine: "local",
      selectedVoiceId: "piper:voice",
    });
    const { result } = renderHook(() =>
      useSettingsForm(["textToSpeechEngine", "selectedVoiceId"]),
    );
    const onChange = vi.fn();
    const unsubscribe = onSettingsChange(onChange);

    act(() =>
      result.current.setValues({
        textToSpeechEngine: "system",
        selectedVoiceId: "",
      }),
    );
    unsubscribe();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(getSettings()).toMatchObject({
      textToSpeechEngine: "system",
      selectedVoiceId: "",
    });
  });

  it("does not write when no value changed", () => {
    const { result } = renderHook(() => useSettingsForm(["enterToSubmit"]));
    const onChange = vi.fn();
    const unsubscribe = onSettingsChange(onChange);

    act(() => result.current.setFieldValue("enterToSubmit", true));
    unsubscribe();

    expect(onChange).not.toHaveBeenCalled();
  });
});
