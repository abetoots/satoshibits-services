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
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "number":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "boolean":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "null":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
      case "object":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "array":
        return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
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
    <div className="grid gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList
          className={`grid ${
            allowedTabs.length <= 3
              ? `grid-cols-${allowedTabs.length}`
              : "grid-cols-3 md:grid-cols-6"
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
        <div className="mt-4">
          <TabsContent value="string">
            <div className="flex flex-col gap-2">
              <Label htmlFor="string-value">String Value</Label>
              <div className="flex gap-2">
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
                  <Plus className="h-4 w-4 mr-1" /> Add enum
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="number">
            <div className="flex flex-col gap-2">
              <Label htmlFor="number-value">Number Value</Label>
              <div className="flex gap-2">
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
                  <Plus className="h-4 w-4 mr-1" /> Add enum
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="boolean">
            <div className="flex flex-col gap-4">
              <Label>Boolean Value</Label>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="true-value"
                    checked={enumValues.includes(true)}
                    onCheckedChange={() => addBooleanValue(true)}
                    disabled={disabled}
                  />
                  <Label htmlFor="true-value">true</Label>
                </div>
                <div className="flex items-center gap-2">
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
            <div className="flex flex-col gap-4">
              <Label>Null Value</Label>
              <div className="flex items-center gap-2">
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
            <div className="flex flex-col gap-2">
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
                <Alert variant="destructive" className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{objectError}</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={addObjectValue}
                className="mt-2 self-start"
                disabled={disabled}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Object
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="array">
            <div className="flex flex-col gap-2">
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
                <Alert variant="destructive" className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{arrayError}</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={addArrayValue}
                className="mt-2 self-start"
                disabled={disabled}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Array
              </Button>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <div className="mt-6">
        <h3 className="text-lg font-medium mb-2">Current Enum Values</h3>
        {enumValues.length === 0 ? (
          <div className="text-muted-foreground text-center py-4 border rounded-md">
            No values added yet
          </div>
        ) : (
          <ScrollArea className="h-[200px] border rounded-md p-4">
            <ul className="space-y-2">
              {enumValues.map((value, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between p-2 border rounded-md bg-muted/30"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Badge
                      variant="outline"
                      className={`${getTypeColor(getValueType(value))} font-mono text-xs`}
                    >
                      {getValueType(value)}
                    </Badge>
                    <span className="font-mono text-sm truncate max-w-[300px]">
                      {getValueDisplay(value)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeValue(index)}
                    className="h-8 w-8"
                    disabled={disabled}
                    aria-label="Remove value"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      {showGeneratedSchema && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-2">Generated Schema</h3>
          <div className="bg-muted p-4 rounded-md">
            <pre className="text-sm font-mono overflow-x-auto">
              {JSON.stringify(generateSchema(), null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );

  const footer = showFooter ? (
    <div className="flex justify-between">
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
          className="flex items-center gap-1"
          disabled={disabled}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" /> Copy Schema
            </>
          )}
        </Button>
      )}
    </div>
  ) : null;

  if (!showCard) {
    return (
      <div className="space-y-4">
        {content}
        {footer}
      </div>
    );
  }

  return (
    <Card className="w-full">
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
