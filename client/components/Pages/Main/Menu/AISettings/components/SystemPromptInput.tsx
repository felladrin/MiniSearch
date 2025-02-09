import { Text, Textarea } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { defaultSettings } from "../../../../../../modules/settings";

interface SystemPromptInputProps {
  form: UseFormReturnType<typeof defaultSettings>;
}

export const SystemPromptInput = ({ form }: SystemPromptInputProps) => {
  const isUsingCustomInstructions =
    form.values.systemPrompt !== defaultSettings.systemPrompt;

  const handleRestoreDefaultInstructions = () => {
    form.setFieldValue("systemPrompt", defaultSettings.systemPrompt);
  };

  return (
    <Textarea
      label="Instructions for AI"
      descriptionProps={{ component: "div" }}
      description={
        <>
          <span>
            Customize instructions for the AI to tailor its responses.
          </span>
          <br />
          <span>For example:</span>
          <ul>
            <li>
              Specify preferences
              <ul>
                <li>
                  <em>"use simple language"</em>
                </li>
                <li>
                  <em>"provide step-by-step explanations"</em>
                </li>
              </ul>
            </li>
            <li>
              Set a response style
              <ul>
                <li>
                  <em>"answer in a friendly tone"</em>
                </li>
                <li>
                  <em>"write your response in Spanish"</em>
                </li>
              </ul>
            </li>
            <li>
              Provide context about the audience
              <ul>
                <li>
                  <em>"you're talking to a high school student"</em>
                </li>
                <li>
                  <em>
                    "consider that your audience is composed of professionals in
                    the field of graphic design"
                  </em>
                </li>
              </ul>
            </li>
          </ul>
          <span>
            The special tag <em>{"{{searchResults}}"}</em> will be replaced with
            the search results, while <em>{"{{dateTime}}"}</em> will be replaced
            with the current date and time.
          </span>
          {isUsingCustomInstructions && (
            <>
              <br />
              <br />
              <span>
                Currently, you're using custom instructions. If you ever need to
                restore the default instructions, you can do so by clicking
              </span>{" "}
              <Text
                component="span"
                size="xs"
                c="blue"
                style={{ cursor: "pointer" }}
                onClick={handleRestoreDefaultInstructions}
              >
                here
              </Text>
              <span>.</span>
            </>
          )}
        </>
      }
      autosize
      maxRows={10}
      {...form.getInputProps("systemPrompt")}
    />
  );
};
