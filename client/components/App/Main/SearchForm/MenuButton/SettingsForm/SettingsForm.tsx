import { usePubSub } from "create-pubsub/react";
import { settingsPubSub } from "../../../../../../modules/pubSub";
import {
  isF16Supported,
  isWebGPUAvailable,
} from "../../../../../../modules/webGpu";
import { match, Pattern } from "ts-pattern";
import {
  InputNumber,
  SelectPicker,
  Form,
  Toggle,
  Slider,
  Input,
  Text,
} from "rsuite";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { forwardRef, useRef } from "react";
import { backgroundImageOptions } from "../../../../../../modules/backgroundImage";
import { Setting, Settings } from "../../../../../../modules/settings";
import { wllamaModels } from "../../../../../../modules/wllama";
import { addLogEntry } from "../../../../../../modules/logEntries";

const Textarea = forwardRef((props, ref) => (
  <Input {...props} as="textarea" ref={ref as never} />
));

export function SettingsForm() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const suffix = isF16Supported ? "-q4f16_1-MLC" : "-q4f32_1-MLC";
  const webGpuModels = useRef(
    prebuiltAppConfig.model_list
      .filter((model) => model.model_id.endsWith(suffix))
      .sort((a, b) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0))
      .map((model) => ({
        label: `${model.model_id.replace(suffix, "")} • ${
          Math.round(model.vram_required_MB ?? 0) || "N/A"
        } MB`,
        value: model.model_id,
      })),
  );

  const wllamaModelOptions = useRef(
    Object.entries(wllamaModels).map(([value, { label }]) => ({
      label,
      value,
    })),
  );

  const handleChange = (formValue: Record<string, unknown>) => {
    if (formValue.cpuThreads && typeof formValue.cpuThreads !== "number") {
      const cpuThreadsAsNumber = Number(formValue.cpuThreads);
      formValue.cpuThreads = isNaN(cpuThreadsAsNumber) ? 1 : cpuThreadsAsNumber;
    }

    setSettings(formValue as Settings);
    addLogEntry("User updated the settings");
  };

  return (
    <Form
      formValue={settings}
      onChange={handleChange}
      style={{ maxWidth: "100%" }}
      fluid
    >
      <Form.Group>
        <Form.ControlLabel>AI Response</Form.ControlLabel>
        <Form.Control
          name={Setting.enableAiResponse}
          accepter={Toggle}
          unCheckedChildren="Disabled"
          checkedChildren="Enabled"
        />
        <Form.HelpText>
          Enable or disable AI-generated responses to your queries. When
          disabled, you'll only see web search results.
        </Form.HelpText>
      </Form.Group>
      {settings.enableAiResponse && (
        <Form.Group>
          <Form.ControlLabel>Search results to consider</Form.ControlLabel>
          <Form.Control
            name={Setting.searchResultsToConsider}
            accepter={Slider}
            min={0}
            max={6}
            graduated
            progress
            renderMark={(mark) => mark}
            style={{ marginLeft: "8px", marginRight: "16px" }}
          />
          <Form.HelpText>
            Determines the number of search results to consider when generating
            AI responses. A higher value may enhance accuracy, but it will also
            increase response time.
          </Form.HelpText>
        </Form.Group>
      )}
      <Form.Group>
        <Form.ControlLabel>Image Search</Form.ControlLabel>
        <Form.Control
          name={Setting.enableImageSearch}
          accepter={Toggle}
          unCheckedChildren="Disabled"
          checkedChildren="Enabled"
        />
        <Form.HelpText>
          Enable or disable image search results. When enabled, relevant images
          will be displayed alongside web search results.
        </Form.HelpText>
      </Form.Group>
      {isWebGPUAvailable && (
        <Form.Group>
          <Form.ControlLabel>WebGPU</Form.ControlLabel>
          <Form.Control
            name={Setting.enableWebGpu}
            accepter={Toggle}
            unCheckedChildren="Disabled"
            checkedChildren="Enabled"
          />
          <Form.HelpText>
            Enable or disable WebGPU usage. When disabled, the app will use the
            CPU instead.
          </Form.HelpText>
        </Form.Group>
      )}
      {match([isWebGPUAvailable, settings.enableWebGpu])
        .with([true, true], () => (
          <Form.Group>
            <Form.ControlLabel>AI Model</Form.ControlLabel>
            <Form.Control
              name={Setting.webLlmModelId}
              accepter={SelectPicker}
              cleanable={false}
              placement="auto"
              preventOverflow={true}
              data={webGpuModels.current}
            />
            <Form.HelpText>
              Select the model to use for AI responses.
            </Form.HelpText>
          </Form.Group>
        ))
        .with([false, Pattern.any], [Pattern.any, false], () => (
          <>
            <Form.Group>
              <Form.ControlLabel>AI Model</Form.ControlLabel>
              <Form.Control
                name={Setting.wllamaModelId}
                accepter={SelectPicker}
                cleanable={false}
                placement="auto"
                preventOverflow={true}
                data={wllamaModelOptions.current}
              />
              <Form.HelpText>
                Select the model to use for AI responses.
              </Form.HelpText>
            </Form.Group>
            <Form.Group>
              <Form.ControlLabel>CPU threads to use</Form.ControlLabel>
              <Form.Control
                name={Setting.cpuThreads}
                accepter={InputNumber}
                min={1}
              />
              <Form.HelpText>
                Number of threads to use for the AI model. Lower values will use
                less CPU, but may take longer to respond. A too-high value may
                cause the app to hang.
              </Form.HelpText>
            </Form.Group>
          </>
        ))
        .otherwise(() => null)}
      <Form.Group>
        <Form.ControlLabel>Instructions for AI</Form.ControlLabel>
        <Form.Control
          name={Setting.systemPrompt}
          accepter={Textarea}
          style={{ width: "100%", minHeight: "150px" }}
        />
        <Form.HelpText>
          Customize instructions for the AI to tailor its responses.
          <br />
          For example:
          <ul>
            <li>
              Specify preferences
              <ul>
                <li>
                  <Text as="cite" muted>
                    "use simple language"
                  </Text>
                </li>
                <li>
                  <Text as="cite" muted>
                    "provide step-by-step explanations"
                  </Text>
                </li>
              </ul>
            </li>
            <li>
              Set a response style
              <ul>
                <li>
                  <Text as="cite" muted>
                    "answer in a friendly tone"
                  </Text>
                </li>
                <li>
                  <Text as="cite" muted>
                    "write your response in Spanish"
                  </Text>
                </li>
              </ul>
            </li>
            <li>
              Provide context about the audience
              <ul>
                <li>
                  <Text as="cite" muted>
                    "you're talking to a high school student"
                  </Text>
                </li>
                <li>
                  <Text as="cite" muted>
                    "consider that your audience is composed of professionals in
                    the field of graphic design"
                  </Text>
                </li>
              </ul>
            </li>
          </ul>
          Note: The special tag <Text as="code">{`{{searchResults}}`}</Text>{" "}
          will be replaced with the search results.
        </Form.HelpText>
      </Form.Group>
      <Form.Group>
        <Form.ControlLabel>Background Image</Form.ControlLabel>
        <Form.Control
          name={Setting.backgroundImageUrl}
          accepter={SelectPicker}
          searchable={false}
          cleanable={false}
          placement="auto"
          preventOverflow={true}
          data={backgroundImageOptions}
        />
        <Form.HelpText>Select a background image for decoration.</Form.HelpText>
      </Form.Group>
    </Form>
  );
}
