import { SchemaBuilder } from "@/packages/builder/schema-builder";
import { JSONSchema7 } from "json-schema";
import { createTestSchema, generateSampleData } from "./packages/builder/utils";
import { useMemo, useState } from "react";
import JSONInput from "react-json-editor-ajrm";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
import locale from "react-json-editor-ajrm/locale/en";
import { NumberConstraintPlugin } from "./packages/plugins/number";
import { StringConstraintPlugin } from "./packages/plugins/string";
import { ArrayConstraintPlugin } from "./packages/plugins/array";
import { EnumConstraintPlugin } from "./packages/plugins/enum";

const Dev = () => {
  const [schema, setSchema] = useState<JSONSchema7>();

  const sampleData = useMemo(() => {
    try {
      return schema ? generateSampleData(schema) : null;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [schema]);

  const testSchema = useMemo(() => createTestSchema(), []);

  return (
    <div className="bg-yellow-50/50 p-4">
      <SchemaBuilder
        initialSchema={testSchema}
        plugins={[
          NumberConstraintPlugin,
          StringConstraintPlugin,
          ArrayConstraintPlugin,
          EnumConstraintPlugin,
        ]}
        onSchemaChange={(schema) => {
          setSchema(schema);
          console.log("onSchemaChange", schema);
        }}
        onPropertyAddSuccess={(property) => {
          console.log("onPropertyAddSuccess", property);
        }}
      />

      <div className="mt-6">
        <h1 className="text-3xl font-bold">JSON Schema: </h1>
        {/* @ts-expect-error Just a type issue */}
        <JSONInput
          id="json-editor"
          placeholder={schema}
          locale={locale as JSONInput["props"]["locale"]}
          height="100%"
          width="100%"
          onChange={(e: Record<string, unknown>) => console.log(e)}
        />
      </div>

      <div className="mt-6">
        <h1 className="text-3xl font-bold">Sample Data: </h1>
        {/* @ts-expect-error Just a type issue */}
        <JSONInput
          id="json-editor"
          placeholder={sampleData}
          locale={locale as JSONInput["props"]["locale"]}
          height="100%"
          width="100%"
          onChange={(e: Record<string, unknown>) => console.log(e)}
        />
      </div>
    </div>
  );
};

export default Dev;
