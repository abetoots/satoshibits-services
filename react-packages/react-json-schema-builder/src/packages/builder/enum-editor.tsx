import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Check, Copy, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";

type EnumValue = string | number | boolean | null | object | unknown[];

export interface EnumEditorProps {
  /** Initial enum values to populate the editor */
  initialValues?: EnumValue[];
  /** Called when the enum values change */
  onChange?: (values: EnumValue[]) => void;
  /** Called when the user clicks the save button */
  onSave?: (schema: { enum: EnumValue[] }) => void;
  /** Show the card wrapper */
  showCard?: boolean;
  /** Show the generated schema section */
  showGeneratedSchema?: boolean;
  /** Error message to display */
  error?: { code: string; message: string };
  /** Property type to filter available tabs */
  propertyType?: string | string[];
  /** Disable the editor */
  disabled?: boolean;
  /** Show the footer section */
  showFooter?: boolean;
}

export function EnumEditor({
  initialValues,
  onSave,
  showCard = true,
  showGeneratedSchema = true,
  error,
  propertyType,
  disabled,
  onChange,
  showFooter = true,
}: EnumEditorProps) {
  const [enumValues, setEnumValues] = useState<EnumValue[]>(
    initialValues ?? [],
  );
  const [stringValue, setStringValue] = useState("");
  const [numberValue, setNumberValue] = useState("");
  const [objectValue, setObjectValue] = useState("{}");
  const [arrayValue, setArrayValue] = useState("[]");
  const [activeTab, setActiveTab] = useState("string");
  const [objectError, setObjectError] = useState("");
  const [arrayError, setArrayError] = useState("");
  const [copied, setCopied] = useState(false);

  // Define which tabs are allowed for each property type
  const allowedTabsByType: Record<string, string[]> = useMemo(
    () => ({
      string: ["string"],
      number: ["number"],
      integer: ["number"],
      boolean: ["boolean"],
      null: ["null"],
      object: ["object"],
      array: ["array"],
      // If no property type is provided, allow all tabs
      undefined: ["string", "number", "boolean", "null", "object", "array"],
    }),
    [],
  );

  // Get allowed tabs based on propertyType, defaulting to all tabs if no type provided
  const allowedTabs = useMemo(
    () =>
      Array.isArray(propertyType)
        ? propertyType.reduce((acc, curr) => {
            return [...acc, ...allowedTabsByType[curr]!];
          }, [] as string[])
        : (allowedTabsByType[propertyType ?? "undefined"] ?? [
            "string",
            "number",
            "boolean",
            "null",
            "object",
            "array",
          ]),
    [propertyType, allowedTabsByType],
  );

  // Set the initial active tab to the first allowed tab
  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]!);
    }
  }, [allowedTabs]);

  const handleChangeValue = (newVal: EnumValue) => {
    if (onChange) {
      onChange([...enumValues, newVal]);
    }
    setEnumValues([...enumValues, newVal]);
  };

  const addStringValue = () => {
    if (stringValue.trim() !== "") {
      handleChangeValue(stringValue);
      setStringValue("");
    }
  };

  const addNumberValue = () => {
    if (numberValue.trim() !== "") {
      const num = Number.parseFloat(numberValue);
      if (!isNaN(num)) {
        handleChangeValue(num);
        setNumberValue("");
      }
    }
  };

  const addBooleanValue = (value: boolean) => {
    if (!enumValues.includes(value)) {
      handleChangeValue(value);
    }
  };

  const addNullValue = () => {
    if (!enumValues.includes(null)) {
      handleChangeValue(null);
    }
  };

  const addObjectValue = () => {
    try {
      const obj = JSON.parse(objectValue) as unknown;
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        handleChangeValue(obj);
        setObjectValue("{}");
        setObjectError("");
      } else {
        setObjectError("Invalid object format");
      }
    } catch {
      setObjectError("Invalid JSON");
    }
  };

  const addArrayValue = () => {
    try {
      const arr = JSON.parse(arrayValue) as unknown;
      if (Array.isArray(arr)) {
        handleChangeValue(arr);
        setArrayValue("[]");
        setArrayError("");
      } else {
        setArrayError("Invalid array format");
      }
    } catch {
      setArrayError("Invalid JSON");
    }
  };

  const removeValue = (index: number) => {
    const newValues = [...enumValues];
    newValues.splice(index, 1);
    setEnumValues(newValues);
  };

  const getValueType = (value: EnumValue): string => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  };

  const getValueDisplay = (value: EnumValue): string => {
    if (value === null) return "null";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const getTypeColor = (type: string): string => {
    switch (type) {
      case "string":
        return "rjsb:bg-green-100 rjsb:text-green-800 rjsb:dark:bg-green-900 rjsb:dark:text-green-300";
      case "number":
        return "rjsb:bg-blue-100 rjsb:text-blue-800 rjsb:dark:bg-blue-900 rjsb:dark:text-blue-300";
      case "boolean":
        return "rjsb:bg-purple-100 rjsb:text-purple-800 rjsb:dark:bg-purple-900 rjsb:dark:text-purple-300";
      case "null":
        return "rjsb:bg-gray-100 rjsb:text-gray-800 rjsb:dark:bg-gray-800 rjsb:dark:text-gray-300";
      case "object":
        return "rjsb:bg-yellow-100 rjsb:text-yellow-800 rjsb:dark:bg-yellow-900 rjsb:dark:text-yellow-300";
      case "array":
        return "rjsb:bg-pink-100 rjsb:text-pink-800 rjsb:dark:bg-pink-900 rjsb:dark:text-pink-300";
      default:
        return "rjsb:bg-gray-100 rjsb:text-gray-800 rjsb:dark:bg-gray-800 rjsb:dark:text-gray-300";
    }
  };

  const generateSchema = () => {
    return {
      enum: enumValues,
    };
  };

  const copyToClipboard = () => {
    const schema = JSON.stringify(generateSchema(), null, 2);
    void navigator.clipboard.writeText(schema);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    onSave?.(generateSchema());
  };

  const content = (
    <div className="rjsb:grid rjsb:gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="rjsb:h-4 rjsb:w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList
          className={`rjsb:grid ${
            allowedTabs.length <= 3
              ? `rjsb:grid-cols-${allowedTabs.length}`
              : "rjsb:grid-cols-3 rjsb:md:grid-cols-6"
          }`}
        >
          {allowedTabs.includes("string") && (
            <TabsTrigger value="string">String</TabsTrigger>
          )}
          {allowedTabs.includes("number") && (
            <TabsTrigger value="number">Number</TabsTrigger>
          )}
          {allowedTabs.includes("boolean") && (
            <TabsTrigger value="boolean">Boolean</TabsTrigger>
          )}
          {allowedTabs.includes("null") && (
            <TabsTrigger value="null">Null</TabsTrigger>
          )}
          {allowedTabs.includes("object") && (
            <TabsTrigger value="object">Object</TabsTrigger>
          )}
          {allowedTabs.includes("array") && (
            <TabsTrigger value="array">Array</TabsTrigger>
          )}
        </TabsList>
        <div className="rjsb:mt-4">
          <TabsContent value="string">
            <div className="rjsb:flex rjsb:flex-col rjsb:gap-2">
              <Label htmlFor="string-value">String Value</Label>
              <div className="rjsb:flex rjsb:gap-2">
                <Input
                  id="string-value"
                  value={stringValue}
                  onChange={(e) => setStringValue(e.target.value)}
                  placeholder="Enter a string value"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addStringValue();
                  }}
                  disabled={disabled}
                />
                <Button onClick={addStringValue} size="sm" disabled={disabled}>
                  <Plus className="rjsb:h-4 rjsb:w-4 rjsb:mr-1" /> Add enum
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="number">
            <div className="rjsb:flex rjsb:flex-col rjsb:gap-2">
              <Label htmlFor="number-value">Number Value</Label>
              <div className="rjsb:flex rjsb:gap-2">
                <Input
                  id="number-value"
                  value={numberValue}
                  onChange={(e) => setNumberValue(e.target.value)}
                  placeholder="Enter a number value"
                  type="number"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addNumberValue();
                  }}
                  disabled={disabled}
                />
                <Button
                  onClick={addNumberValue}
                  size="sm"
                  disabled={disabled}
                  aria-label="Add enum"
                >
                  <Plus className="rjsb:h-4 rjsb:w-4 rjsb:mr-1" /> Add enum
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="boolean">
            <div className="rjsb:flex rjsb:flex-col rjsb:gap-4">
              <Label>Boolean Value</Label>
              <div className="rjsb:flex rjsb:gap-4">
                <div className="rjsb:flex rjsb:items-center rjsb:gap-2">
                  <Switch
                    id="true-value"
                    checked={enumValues.includes(true)}
                    onCheckedChange={() => addBooleanValue(true)}
                    disabled={disabled}
                  />
                  <Label htmlFor="true-value">true</Label>
                </div>
                <div className="rjsb:flex rjsb:items-center rjsb:gap-2">
                  <Switch
                    id="false-value"
                    checked={enumValues.includes(false)}
                    onCheckedChange={() => addBooleanValue(false)}
                    disabled={disabled}
                  />
                  <Label htmlFor="false-value">false</Label>
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="null">
            <div className="rjsb:flex rjsb:flex-col rjsb:gap-4">
              <Label>Null Value</Label>
              <div className="rjsb:flex rjsb:items-center rjsb:gap-2">
                <Switch
                  id="null-value"
                  checked={enumValues.includes(null)}
                  onCheckedChange={() => addNullValue()}
                  disabled={disabled}
                />
                <Label htmlFor="null-value">Include null value</Label>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="object">
            <div className="rjsb:flex rjsb:flex-col rjsb:gap-2">
              <Label htmlFor="object-value">Object Value (JSON)</Label>
              <Textarea
                id="object-value"
                value={objectValue}
                onChange={(e) => {
                  setObjectValue(e.target.value);
                  setObjectError("");
                }}
                placeholder='{"key": "value"}'
                rows={4}
                disabled={disabled}
              />
              {objectError && (
                <Alert variant="destructive" className="rjsb:mt-2">
                  <AlertCircle className="rjsb:h-4 rjsb:w-4" />
                  <AlertDescription>{objectError}</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={addObjectValue}
                className="rjsb:mt-2 rjsb:self-start"
                disabled={disabled}
              >
                <Plus className="rjsb:h-4 rjsb:w-4 rjsb:mr-1" /> Add Object
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="array">
            <div className="rjsb:flex rjsb:flex-col rjsb:gap-2">
              <Label htmlFor="array-value">Array Value (JSON)</Label>
              <Textarea
                id="array-value"
                value={arrayValue}
                onChange={(e) => {
                  setArrayValue(e.target.value);
                  setArrayError("");
                }}
                placeholder='[1, "two", true]'
                rows={4}
                disabled={disabled}
              />
              {arrayError && (
                <Alert variant="destructive" className="rjsb:mt-2">
                  <AlertCircle className="rjsb:h-4 rjsb:w-4" />
                  <AlertDescription>{arrayError}</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={addArrayValue}
                className="rjsb:mt-2 rjsb:self-start"
                disabled={disabled}
              >
                <Plus className="rjsb:h-4 rjsb:w-4 rjsb:mr-1" /> Add Array
              </Button>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <div className="rjsb:mt-6">
        <h3 className="rjsb:text-lg rjsb:font-medium rjsb:mb-2">Current Enum Values</h3>
        {enumValues.length === 0 ? (
          <div className="rjsb:text-muted-foreground rjsb:text-center rjsb:py-4 rjsb:border rjsb:rounded-md">
            No values added yet
          </div>
        ) : (
          <ScrollArea className="rjsb:h-[200px] rjsb:border rjsb:rounded-md rjsb:p-4">
            <ul className="rjsb:space-y-2">
              {enumValues.map((value, index) => (
                <li
                  key={index}
                  className="rjsb:flex rjsb:items-center rjsb:justify-between rjsb:p-2 rjsb:border rjsb:rounded-md rjsb:bg-muted/30"
                >
                  <div className="rjsb:flex rjsb:items-center rjsb:gap-2 rjsb:overflow-hidden">
                    <Badge
                      variant="outline"
                      className={`${getTypeColor(getValueType(value))} rjsb:font-mono rjsb:text-xs`}
                    >
                      {getValueType(value)}
                    </Badge>
                    <span className="rjsb:font-mono rjsb:text-sm rjsb:truncate rjsb:max-w-[300px]">
                      {getValueDisplay(value)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeValue(index)}
                    className="rjsb:h-8 rjsb:w-8"
                    disabled={disabled}
                    aria-label="Remove value"
                  >
                    <Trash2 className="rjsb:h-4 rjsb:w-4 rjsb:text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      {showGeneratedSchema && (
        <div className="rjsb:mt-6">
          <h3 className="rjsb:text-lg rjsb:font-medium rjsb:mb-2">Generated Schema</h3>
          <div className="rjsb:bg-muted rjsb:p-4 rjsb:rounded-md">
            <pre className="rjsb:text-sm rjsb:font-mono rjsb:overflow-x-auto">
              {JSON.stringify(generateSchema(), null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );

  const footer = showFooter ? (
    <div className="rjsb:flex rjsb:justify-between">
      <Button
        variant="outline"
        onClick={() => setEnumValues([])}
        disabled={disabled}
      >
        Clear All
      </Button>
      {onSave ? (
        <Button onClick={handleSave} disabled={disabled}>
          Save
        </Button>
      ) : (
        <Button
          onClick={copyToClipboard}
          className="rjsb:flex rjsb:items-center rjsb:gap-1"
          disabled={disabled}
        >
          {copied ? (
            <>
              <Check className="rjsb:h-4 rjsb:w-4" /> Copied
            </>
          ) : (
            <>
              <Copy className="rjsb:h-4 rjsb:w-4" /> Copy Schema
            </>
          )}
        </Button>
      )}
    </div>
  ) : null;

  if (!showCard) {
    return (
      <div className="rjsb:space-y-4">
        {content}
        {footer}
      </div>
    );
  }

  return (
    <Card className="rjsb:w-full">
      <CardHeader>
        <CardTitle>Enum Values Editor</CardTitle>
        <CardDescription>
          Add allowed values of different types to your enum property
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
      <CardFooter>{footer}</CardFooter>
    </Card>
  );
}
