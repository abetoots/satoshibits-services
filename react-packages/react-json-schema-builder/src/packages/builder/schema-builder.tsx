import { useEffect, useState, Fragment } from "react";
import { PropertyAddError, PropertyAddSuccess, useSchema } from "./context";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Switch } from "@/components/ui/switch";
import { Bolt, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { JSONSchema7 } from "json-schema";
import { clone } from "remeda";
import {
  BaseJSONSchemaPlugin,
  usePluginSystem,
} from "@/packages/constraints/context";
import { EditPropertyDialog } from "./edit-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { validateSchema } from "./utils";
import Ajv from "ajv";
import { DebouncedInput } from "@/components/depounced-input";
import { AddPropertyDialog, type AddPropertyDialogProps } from "./add-dialog";
import { cn, ROOT_CLASS } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const withTooltip = (label: string, button: React.ReactElement) => (
  <Tooltip>
    <TooltipTrigger asChild>{button}</TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

// PropertyComponent type definition for custom property components
export interface PropertyComponentProps {
  property: {
    key: string;
    schema: JSONSchema7;
    isRequired: boolean;
  };
  onPropertyChange: (key: string, changes: Partial<JSONSchema7>) => void;
  onKeyChange: (oldKey: string, newKey: string) => void;
  onDelete: (key: string) => void;
  onDuplicate?: (key: string) => void;
  onNavigate?: (key: string) => void;
  disabled?: boolean;
}

// NavigationProps for custom navigation component
export interface NavigationProps {
  currentPath: string[];
  onNavigateUp: () => void;
  onNavigateTo: (newPath: string[]) => void;
  isRootPath: boolean;
}

// AddPropertyButtonProps for custom add property button
export interface AddPropertyButtonProps {
  onClick: () => void;
}

interface SchemaBuilderProps {
  /** The schema to edit */
  initialSchema?: JSONSchema7;
  /** Constraint plugins to use */
  plugins?: BaseJSONSchemaPlugin[];
  /** Custom component to render properties */
  propertyComponent?: React.ComponentType<PropertyComponentProps>;
  /** Called when the schema changes */
  onSchemaChange?: (schema: JSONSchema7) => void;
  /** Called when a property is successfully added */
  onPropertyAddSuccess?: (props: PropertyAddSuccess) => void;
  /** Called when there's an error adding a property */
  onPropertyAddError?: (props: PropertyAddError) => void;
  /** Called when there's an error changing a property */
  onPropertyChangeError?: (prop: Error) => void;
  /** Called when a property is successfully changed */
  onPropertyChangeSuccess?: () => void;
  /** Class name for the navigation bar back button */
  backButtonClassName?: string;
  /** Class name for the properties list container */
  propertiesListClassName?: string;
  /** Class name for the add property button */
  addPropertyButtonClassName?: string;
  /** Custom navigation component */
  navigationComponent?: React.ComponentType<NavigationProps>;
  /** Custom add property button component */
  addPropertyButtonComponent?: React.ComponentType<AddPropertyButtonProps>;
  /** Array of property keys that should be disabled (read-only) */
  disabledProperties?: string[];
  /** Whether all properties should be disabled (read-only) */
  disabled?: boolean;
}

export const SchemaBuilder = (props: SchemaBuilderProps) => {
  // State
  const [showPropertyDialog, setShowPropertyDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | undefined>();
  const [editingKey, setEditingKey] = useState<string | undefined>();
  // a fresh add form and focus scope per open
  const [addSession, setAddSession] = useState(0);
  // a fresh edit form per open, so no row's values carry into another (N4)
  const [editSession, setEditSession] = useState(0);
  // a fresh delete focus scope per open
  const [deleteSession, setDeleteSession] = useState(0);
  const [editingProperty, setEditingProperty] = useState<
    JSONSchema7 | undefined
  >();
  const [schemaValidationError, setSchemaValidationError] = useState<
    string | null
  >(null);

  // Initialize the plugin system
  usePluginSystem(props.plugins ?? []);

  // Get schema context
  const {
    getCurrentSchema,
    setPath,
    path,
    handleAddProperty,
    handlePropertyChange,
    handleKeyChange,
    handleDeleteProperty,
    setSchema,
    isPropertyRequired,
    handleDuplicateProperty,
  } = useSchema({ onSchemaChange: props.onSchemaChange });

  // Set schema from props
  useEffect(() => {
    if (props.initialSchema) {
      try {
        // Validate the schema before setting it
        validateSchema(props.initialSchema);
        setSchema(clone(props.initialSchema));
        setSchemaValidationError(null);
      } catch (error) {
        if (error instanceof Error) {
          setSchemaValidationError(error.message);
        } else if (error instanceof Ajv.ValidationError) {
          setSchemaValidationError(`Schema validation error: ${error.message}`);
        } else {
          setSchemaValidationError("Unknown schema validation error");
        }
      }
    }
  }, [props.initialSchema]);

  const currentSchema = getCurrentSchema();

  // Check if a property is disabled
  const isPropertyDisabled = (key: string): boolean => {
    return props.disabled === true || !!props.disabledProperties?.includes(key);
  };

  // Navigation handlers
  const handleNavigateToProperty = (name: string) => {
    setPath([...path, name]);
  };

  const handleNavigateUp = () => {
    setPath(path.slice(0, -1));
  };

  // Property management handlers
  const handleEditProperty = (key: string, property: JSONSchema7) => {
    // Don't allow editing if property is disabled
    if (isPropertyDisabled(key)) return;

    setEditingKey(key);
    setEditingProperty(property);
    setEditSession((n) => n + 1);
    setShowEditDialog(true);
  };

  const handleInitiateDelete = (key: string) => {
    // Don't allow deletion if property is disabled
    if (isPropertyDisabled(key)) return;

    setDeleteKey(key);
    setDeleteSession((n) => n + 1);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    if (deleteKey) {
      handleDeleteProperty(deleteKey);
      setDeleteKey(undefined);
    }
    setShowDeleteDialog(false);
  };

  const handleCancelDelete = () => {
    setDeleteKey(undefined);
    setShowDeleteDialog(false);
  };

  const handleDuplicate = (key: string) => {
    // Don't allow duplication if property is disabled
    if (isPropertyDisabled(key)) return;

    const result = handleDuplicateProperty(key);

    // Notify if needed
    if (result?.status === "error") {
      props.onPropertyAddError?.(result);
    } else if (result?.status === "success") {
      props.onPropertyAddSuccess?.(result);
    }
  };

  const onAddProperty: AddPropertyDialogProps["onSubmit"] = (...vals) => {
    const result = handleAddProperty(...vals);

    if (result.status === "error") {
      props.onPropertyAddError?.(result);
    } else if (result.status === "success") {
      props.onPropertyAddSuccess?.(result);
    }
    setShowPropertyDialog(false);
  };

  // Custom property component or default renderer
  const PropertyComponent = props.propertyComponent;

  const renderProperty = (key: string, property: JSONSchema7) => {
    const isDisabled = isPropertyDisabled(key);

    if (PropertyComponent) {
      return (
        <PropertyComponent
          key={key}
          property={{
            key,
            schema: property,
            isRequired: isPropertyRequired(key),
          }}
          onPropertyChange={handlePropertyChange}
          onKeyChange={handleKeyChange}
          onDelete={handleInitiateDelete}
          onDuplicate={handleDuplicate}
          onNavigate={
            property.type === "object" ||
            (property.type === "array" &&
              typeof property.items === "object" &&
              (property.items as JSONSchema7).type === "object")
              ? handleNavigateToProperty
              : undefined
          }
          disabled={isDisabled}
        />
      );
    }

    // Default property renderer
    return (
      <div
        key={key}
        className={cn(
          "rjsb:flex rjsb:flex-col rjsb:md:grid rjsb:grid-cols-(--rjsb-autofit-grid) rjsb:gap-4 rjsb:md:items-center rjsb:border rjsb:p-2 rjsb:rounded-md rjsb:mb-2 rjsb:overflow-y-auto",
          isDisabled ? "rjsb:opacity-70 " : "",
        )}
      >
        <div className="">
          <DebouncedInput
            value={key}
            onDebounce={(newVal) => handleKeyChange(key, newVal)}
            placeholder="Property Key"
            aria-label={`Property key for ${key}`}
            delay={500}
            disabled={isDisabled}
          />
        </div>

        <div className="rjsb:flex rjsb:items-center rjsb:gap-2">
          <Switch
            checked={isPropertyRequired(key)}
            onCheckedChange={(checked) =>
              handlePropertyChange(key, { isRequired: checked })
            }
            aria-label="Required"
            disabled={isDisabled}
          />
          <Label htmlFor={`required-${key}`}>Required</Label>
        </div>

        <div className="">
          <Select
            value={
              typeof property === "object" && !Array.isArray(property.type)
                ? property.type
                : undefined
            }
            onValueChange={(value) =>
              handlePropertyChange(key, {
                type: value as JSONSchema7["type"],
              })
            }
            aria-label="Type"
            disabled={isDisabled}
          >
            <SelectTrigger className="rjsb:w-full" aria-label="Select type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={"string" satisfies JSONSchema7["type"]}>
                string
              </SelectItem>
              <SelectItem value={"number" satisfies JSONSchema7["type"]}>
                number
              </SelectItem>
              <SelectItem value={"integer" satisfies JSONSchema7["type"]}>
                integer
              </SelectItem>
              <SelectItem value={"boolean" satisfies JSONSchema7["type"]}>
                boolean
              </SelectItem>
              <SelectItem value={"object" satisfies JSONSchema7["type"]}>
                object
              </SelectItem>
              <SelectItem value={"array" satisfies JSONSchema7["type"]}>
                array
              </SelectItem>
              <SelectItem value={"null" satisfies JSONSchema7["type"]}>
                null
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="">
          <DebouncedInput
            value={typeof property === "object" ? property.title : undefined}
            onDebounce={(newVal) =>
              handlePropertyChange(key, { title: newVal })
            }
            placeholder="Title"
            disabled={isDisabled}
          />
        </div>

        <div className="">
          <DebouncedInput
            value={
              typeof property === "object" ? property.description : undefined
            }
            onDebounce={(newVal) =>
              handlePropertyChange(key, { description: newVal })
            }
            placeholder="Description"
            disabled={isDisabled}
          />
        </div>

        <div className="rjsb:order-last rjsb:md:order-none rjsb:flex rjsb:gap-2">
          {/* Delete button */}
          {withTooltip(
            "Delete",
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleInitiateDelete(key)}
              aria-label="Delete"
              className="rjsb:block!"
              disabled={isDisabled}
            >
              <Trash2 size={16} className="rjsb:text-destructive" />
            </Button>,
          )}

          {/* Duplicate button */}
          {withTooltip(
            "Duplicate",
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDuplicate(key)}
              aria-label="Duplicate"
              className="rjsb:block!"
              disabled={isDisabled}
            >
              <Copy size={16} />
            </Button>,
          )}

          {/* Edit button if applicable */}
          {renderEditButton(key, property)}

          {/* Navigate button for objects/array items */}
          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty titles use the key */}
          {renderNavigateButton(key, property, property.title || key)}
        </div>

        {/* Render array items configuration if needed */}
        {renderArrayItemsConfig(key, property)}
      </div>
    );
  };

  // Helper to render array items configuration
  const renderArrayItemsConfig = (key: string, property: JSONSchema7) => {
    if (typeof property !== "object" || property.type !== "array") {
      return null;
    }

    const isDisabled = isPropertyDisabled(key);
    const items = property.items;
    const itemType =
      !Array.isArray(items) &&
      typeof items === "object" &&
      typeof items.type === "string"
        ? items?.type
        : "string";

    return (
      <div className="rjsb:col-span-full rjsb:flex rjsb:items-center rjsb:gap-4 rjsb:pl-8 rjsb:mt-2 rjsb:bg-muted rjsb:p-2 rjsb:rounded-md">
        <Label>Items of type:</Label>
        <Select
          value={itemType as string}
          onValueChange={(value) => {
            const newItems: JSONSchema7 = {
              ...(typeof items === "object" ? items : {}),
              type: value as JSONSchema7["type"],
            };

            if (value === "object") {
              // Initialize empty properties for object type
              newItems.properties = newItems.properties ?? {};
            }

            handlePropertyChange(key, { items: newItems });
          }}
          disabled={isDisabled}
        >
          <SelectTrigger
            className="rjsb:w-[200px] rjsb:bg-background"
            aria-label="Select items of type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={"string" satisfies JSONSchema7["type"]}>
              string
            </SelectItem>
            <SelectItem value={"number" satisfies JSONSchema7["type"]}>
              number
            </SelectItem>
            <SelectItem value={"integer" satisfies JSONSchema7["type"]}>
              integer
            </SelectItem>
            <SelectItem value={"boolean" satisfies JSONSchema7["type"]}>
              boolean
            </SelectItem>
            <SelectItem value={"object" satisfies JSONSchema7["type"]}>
              object
            </SelectItem>
            <SelectItem value={"array" satisfies JSONSchema7["type"]}>
              array
            </SelectItem>
            <SelectItem value={"null" satisfies JSONSchema7["type"]}>
              null
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Configure object button for array items of type object */}
        {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty titles use the key */}
        {renderNavigateButton(key, items, property.title || key)}
      </div>
    );
  };

  // Helper to render the edit button
  const renderEditButton = (key: string, property: JSONSchema7) => {
    if (typeof property !== "object") return null;

    const isDisabled = isPropertyDisabled(key);

    // Should render by default to allow editing default values
    return withTooltip(
      "Edit constraints",
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleEditProperty(key, property)}
        aria-label="Edit constraints"
        disabled={isDisabled}
      >
        <Bolt size={16} />
      </Button>,
    );
  };

  const renderNavigateButton = (
    key: string,
    items: JSONSchema7["items"],
    name: string,
  ) => {
    if (
      !Array.isArray(items) &&
      typeof items === "object" &&
      items?.type === "object"
    ) {
      return withTooltip(
        `Open ${name}`,
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleNavigateToProperty(key)}
          aria-label={`Open ${name}`}
        >
          <ChevronRight size={16} />
        </Button>,
      );
    }

    return null;
  };

  // Render navigation component
  const renderNavigation = () => {
    const NavigationComponent = props.navigationComponent;

    if (NavigationComponent) {
      return (
        <NavigationComponent
          currentPath={path}
          onNavigateUp={handleNavigateUp}
          onNavigateTo={setPath}
          isRootPath={path.length === 0}
        />
      );
    }

    return (
      <div className="rjsb:flex rjsb:items-center rjsb:space-x-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handleNavigateUp}
          disabled={path.length === 0}
          className={cn(props.backButtonClassName)}
        >
          Back
        </Button>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#" onClick={() => setPath([])}>
                Root
              </BreadcrumbLink>
            </BreadcrumbItem>
            {path.map((item, index) => (
              <Fragment key={`path-${index}`}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink
                    href="#"
                    onClick={() => setPath(path.slice(0, index + 1))}
                  >
                    {item}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    );
  };

  // Render add property button
  const renderAddPropertyButton = () => {
    const AddPropertyButtonComponent = props.addPropertyButtonComponent;

    if (AddPropertyButtonComponent) {
      return (
        <AddPropertyButtonComponent
          onClick={() => {
            setAddSession((n) => n + 1);
            setShowPropertyDialog(true);
          }}
        />
      );
    }

    return (
      <Button
        type="button"
        className={cn("rjsb:self-center", props.addPropertyButtonClassName)}
        onClick={() => {
          setAddSession((n) => n + 1);
          setShowPropertyDialog(true);
        }}
        disabled={props.disabled}
      >
        <Plus className="rjsb:h-4 rjsb:w-4 rjsb:mr-2" />
        Add property
      </Button>
    );
  };

  return (
    <TooltipProvider>
      <div className={cn(ROOT_CLASS)}>
        {/* Schema validation error */}
        {schemaValidationError && (
          <Alert variant="destructive">
            <AlertTitle>Schema Error</AlertTitle>
            <AlertDescription>{schemaValidationError}</AlertDescription>
          </Alert>
        )}

        {/* Navigation bar */}
        {renderNavigation()}

        {/* Properties list */}
        <div
          className={cn(
            "rjsb:mt-6 rjsb:overflow-x-hidden",
            props.propertiesListClassName,
          )}
        >
          {Object.entries(currentSchema.properties ?? {}).map(
            ([key, property]) => {
              if (typeof property === "boolean") {
                // We don't support editing boolean properties
                return null;
              }

              return renderProperty(key, property);
            },
          )}
        </div>

        {/* Add property button */}
        {renderAddPropertyButton()}

        {/* Add property dialog */}
        <AddPropertyDialog
          key={`add-${addSession}`}
          open={showPropertyDialog}
          onOpenChange={setShowPropertyDialog}
          onSubmit={onAddProperty}
        />

        {/* Edit property dialog */}
        {editingKey && editingProperty && (
          <EditPropertyDialog
            key={editSession}
            propertyKey={editingKey}
            property={editingProperty}
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            onSubmit={(params) => {
              handlePropertyChange(...params);
              // stays mounted so the dialog fades out; the next open remounts it
              setShowEditDialog(false);
            }}
          />
        )}

        {/* Delete confirmation dialog */}
        <AlertDialog
          key={`delete-${deleteSession}`}
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription className="rjsb:[overflow-wrap:anywhere]">
                This action cannot be undone. This will permanently delete the
                property
                {deleteKey ? ` "${deleteKey}"` : ""} from the schema.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancelDelete}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};
