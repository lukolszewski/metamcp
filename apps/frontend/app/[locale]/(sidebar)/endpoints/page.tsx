"use client";

// Modifications Copyright (c) 2025 Łukasz Olszewski
// Licensed under the GNU Affero General Public License v3.0
// See LICENSE for details.

import {
  CreateEndpointFormData,
  createEndpointFormSchema,
  CreateEndpointRequest,
} from "@repo/zod-types";
import { Check, ChevronDown, Link, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";
import { createTranslatedZodResolver } from "@/lib/zod-resolver";

import { EndpointsList } from "./endpoints-list";

export default function EndpointsPage() {
  const { t } = useTranslations();
  const [createOpen, setCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedNamespaceUuid, setSelectedNamespaceUuid] =
    useState<string>("");
  const [selectedNamespaceName, setSelectedNamespaceName] =
    useState<string>("");

  // Get the tRPC query client for cache invalidation
  const utils = trpc.useUtils();

  // Fetch available namespaces for selection
  const { data: namespacesResponse, isLoading: namespacesLoading } =
    trpc.frontend.namespaces.list.useQuery();

  const availableNamespaces = namespacesResponse?.success
    ? namespacesResponse.data
    : [];

  // tRPC mutation for creating endpoint
  const createEndpointMutation = trpc.frontend.endpoints.create.useMutation({
    onSuccess: (data) => {
      // Check if the operation was actually successful
      if (data.success) {
        toast.success(t("endpoints:endpointCreated"), {
          description: t("endpoints:endpointCreatedDescription", {
            name: form.getValues().name,
          }),
        });
        setCreateOpen(false);
        form.reset({
          name: "",
          description: "",
          namespaceUuid: "",
          enableApiKeyAuth: true,
          enableOauth: false,
          enableSmartMode: false,
          searchMode: "keyword",
          useQueryParamAuth: false,
          createMcpServer: true,
          user_id: undefined, // Default to "For myself" (Private)
        });
        setSelectedNamespaceUuid("");
        setSelectedNamespaceName("");
        // Invalidate and refetch the endpoint list, MCP servers list, and API keys list
        utils.frontend.endpoints.list.invalidate();
        utils.frontend.mcpServers.list.invalidate();
        utils.frontend.apiKeys.list.invalidate();
      } else {
        // Handle business logic failures
        console.error("Endpoint creation failed:", data.message);
        toast.error(t("endpoints:createEndpointError"), {
          description: data.message || "An unexpected error occurred",
        });
      }
    },
    onError: (error) => {
      console.error("Error creating endpoint:", error);
      toast.error(t("endpoints:createEndpointError"), {
        description: error.message || "An unexpected error occurred",
      });
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const form = useForm<CreateEndpointFormData>({
    resolver: createTranslatedZodResolver(createEndpointFormSchema, t),
    defaultValues: {
      name: "",
      description: "",
      namespaceUuid: "",
      enableApiKeyAuth: true,
      enableOauth: false,
      enableSmartMode: false,
      searchMode: "keyword",
      useQueryParamAuth: false,
      createMcpServer: true,
      user_id: undefined, // Default to "For myself" (Private)
    },
  });

  const onSubmit = async (data: CreateEndpointFormData) => {
    setIsSubmitting(true);
    try {
      // Create the API request payload
      const apiPayload: CreateEndpointRequest = {
        name: data.name,
        description: data.description,
        namespaceUuid: data.namespaceUuid,
        enableApiKeyAuth: data.enableApiKeyAuth,
        enableOauth: data.enableOauth,
        enableSmartMode: data.enableSmartMode,
        searchMode: data.searchMode,
        useQueryParamAuth: data.useQueryParamAuth,
        createMcpServer: data.createMcpServer,
        user_id: data.user_id,
      };

      // Use tRPC mutation
      createEndpointMutation.mutate(apiPayload);
    } catch (error) {
      setIsSubmitting(false);
      console.error("Error preparing endpoint data:", error);
      toast.error(t("endpoints:createEndpointError"), {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      });
    }
  };

  const handleNamespaceSelect = (
    namespaceUuid: string,
    namespaceName: string,
  ) => {
    setSelectedNamespaceUuid(namespaceUuid);
    setSelectedNamespaceName(namespaceName);
    form.setValue("namespaceUuid", namespaceUuid);
    form.clearErrors("namespaceUuid");
  };

  const resetForm = () => {
    setCreateOpen(false);
    form.reset({
      name: "",
      description: "",
      namespaceUuid: "",
      enableApiKeyAuth: true,
      enableOauth: false,
      enableSmartMode: false,
      searchMode: "keyword",
      useQueryParamAuth: false,
      createMcpServer: true,
      user_id: undefined, // Default to "For myself" (Private)
    });
    setSelectedNamespaceUuid("");
    setSelectedNamespaceName("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("endpoints:title")}
            </h1>
            <p className="text-muted-foreground">
              {t("endpoints:description")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t("endpoints:createEndpoint")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{t("endpoints:createEndpoint")}</DialogTitle>
                <DialogDescription>
                  {t("endpoints:createEndpointDescription")}
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="flex flex-col gap-2">
                  <label htmlFor="name" className="text-sm font-medium">
                    {t("endpoints:name")}
                  </label>
                  <Input
                    id="name"
                    {...form.register("name")}
                    placeholder={t("endpoints:namePlaceholder")}
                  />
                  {form.formState.errors.name && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    URL-compatible name (alphanumeric, underscore, and hyphen
                    only). This will be accessible at /metamcp/[name]
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="description" className="text-sm font-medium">
                    {t("endpoints:descriptionOptional")}
                  </label>
                  <Textarea
                    id="description"
                    {...form.register("description")}
                    placeholder={t("endpoints:descriptionPlaceholder")}
                    className="h-20"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    {t("endpoints:ownership")}
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                        type="button"
                      >
                        {form.watch("user_id") === null
                          ? t("endpoints:everyone")
                          : t("endpoints:forMyself")}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuItem
                        onClick={() => form.setValue("user_id", undefined)}
                      >
                        {t("endpoints:forMyself")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => form.setValue("user_id", null)}
                      >
                        {t("endpoints:everyone")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="text-xs text-muted-foreground">
                    {t("endpoints:ownershipDescription")}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    {t("endpoints:namespace")}
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="justify-between"
                        type="button"
                      >
                        <span>
                          {selectedNamespaceName ||
                            t("endpoints:selectNamespace")}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      {namespacesLoading ? (
                        <DropdownMenuItem disabled>
                          {t("endpoints:loadingNamespaces")}
                        </DropdownMenuItem>
                      ) : availableNamespaces.length === 0 ? (
                        <DropdownMenuItem disabled>
                          {t("endpoints:noNamespacesAvailable")}
                        </DropdownMenuItem>
                      ) : (
                        availableNamespaces.map((namespace) => (
                          <DropdownMenuItem
                            key={namespace.uuid}
                            onClick={() =>
                              handleNamespaceSelect(
                                namespace.uuid,
                                namespace.name,
                              )
                            }
                            className="flex items-center justify-between"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {namespace.name}
                              </span>
                              {namespace.description && (
                                <span className="text-xs text-muted-foreground">
                                  {namespace.description}
                                </span>
                              )}
                            </div>
                            {selectedNamespaceUuid === namespace.uuid && (
                              <Check className="ml-2 h-4 w-4" />
                            )}
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {form.formState.errors.namespaceUuid && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.namespaceUuid.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("endpoints:namespaceDescription")}
                  </p>
                </div>

                {/* API Key Authentication Settings */}
                <div className="space-y-4 border-t pt-4">
                  <h4 className="text-sm font-medium">
                    {t("endpoints:apiKeyAuth")}
                  </h4>

                  {/* Enable API Key Auth */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium">
                        {t("endpoints:enableApiKeyAuth")}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {t("endpoints:apiKeyAuthDescription")}
                      </p>
                    </div>
                    <Switch
                      checked={form.watch("enableApiKeyAuth")}
                      onCheckedChange={(checked) =>
                        form.setValue("enableApiKeyAuth", checked)
                      }
                      disabled={isSubmitting}
                    />
                  </div>

                  {/* Query Parameter Auth */}
                  {form.watch("enableApiKeyAuth") && (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium">
                          {t("endpoints:useQueryParamAuth")}
                        </label>
                        <p className="text-xs text-muted-foreground">
                          {t("endpoints:queryParamAuthDescription")}
                        </p>
                      </div>
                      <Switch
                        checked={form.watch("useQueryParamAuth")}
                        onCheckedChange={(checked) =>
                          form.setValue("useQueryParamAuth", checked)
                        }
                        disabled={isSubmitting}
                      />
                    </div>
                  )}
                </div>

                {/* OAuth Authentication Settings */}
                <div className="space-y-4 border-t pt-4">
                  <h4 className="text-sm font-medium">
                    {t("endpoints:oauthAuth")}
                  </h4>

                  {/* Enable OAuth Auth */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium">
                        {t("endpoints:enableOauth")}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {t("endpoints:oauthAuthDescription")}
                      </p>
                    </div>
                    <Switch
                      checked={form.watch("enableOauth")}
                      onCheckedChange={(checked) =>
                        form.setValue("enableOauth", checked)
                      }
                      disabled={isSubmitting}
                    />
                  </div>

                  {/* OAuth HTTPS Warning */}
                  {form.watch("enableOauth") && (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/30 rounded-md">
                      <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        {t("endpoints:oauthHttpsWarning")}
                      </p>
                    </div>
                  )}
                </div>

                {/* Smart Mode Settings */}
                <div className="space-y-4 border-t pt-4">
                  <h4 className="text-sm font-medium">Smart Mode</h4>

                  {/* Enable Smart Mode */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <label className="text-sm font-medium">
                        Enable Smart Mode
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Uses an intelligent proxy to discover and execute tools,
                        reducing context size.
                      </p>
                    </div>
                    <Switch
                      checked={form.watch("enableSmartMode")}
                      onCheckedChange={(checked) => {
                        form.setValue("enableSmartMode", checked);
                        if (!checked) {
                          form.setValue("searchMode", "keyword");
                        }
                      }}
                      disabled={isSubmitting}
                    />
                  </div>

                  {/* Search Mode Selection - only show when Smart Mode is enabled */}
                  {form.watch("enableSmartMode") && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Search Method</label>
                      <Select
                        value={form.watch("searchMode")}
                        onValueChange={(value: "keyword" | "embeddings") =>
                          form.setValue("searchMode", value)
                        }
                        disabled={isSubmitting}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select search method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="keyword">
                            <div className="flex flex-col items-start">
                              <span className="font-medium">Keyword Search</span>
                              <span className="text-xs text-muted-foreground">
                                Fast, basic text matching (default)
                              </span>
                            </div>
                          </SelectItem>
                          <SelectItem value="embeddings">
                            <div className="flex flex-col items-start">
                              <span className="font-medium">
                                AI Search (Embeddings)
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Semantic understanding using AI
                              </span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {form.watch("searchMode") === "embeddings" && (
                        <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 p-3 text-xs border border-blue-200 dark:border-blue-800/30">
                          <p className="text-blue-800 dark:text-blue-200">
                            <strong>Note:</strong> AI Search requires
                            EMBEDDINGS_API_KEY to be configured. Tools will be
                            indexed on first connection (may take a few seconds).
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="createMcpServer"
                    checked={form.watch("createMcpServer")}
                    onCheckedChange={(checked) =>
                      form.setValue("createMcpServer", checked as boolean)
                    }
                  />
                  <label
                    htmlFor="createMcpServer"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t("endpoints:createMcpServerDescription")}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("endpoints:createMcpServerExplanation")}
                </p>

                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={isSubmitting}
                  >
                    {t("endpoints:cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting || !selectedNamespaceUuid}
                  >
                    {isSubmitting
                      ? t("endpoints:creating")
                      : t("endpoints:createEndpoint")}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <EndpointsList />
    </div>
  );
}
