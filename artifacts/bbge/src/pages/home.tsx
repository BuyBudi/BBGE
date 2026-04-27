import React, { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  ExternalLink,
  Info,
  Server,
  Terminal,
  Activity,
  Globe,
  Loader2,
  SearchCode,
  Bug,
  Tag,
  Cpu,
  Lock,
  FileText,
  Upload,
  MessageSquare,
  X,
  ChevronDown,
} from "lucide-react";

import { useBbgeHealth, useBbgeExtract, type BbgeExtractResult } from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  url: z.string().url({ message: "Please enter a valid URL." }),
});

type ExtractResult = BbgeExtractResult & {
  status?: string;
  extraction: BbgeExtractResult["extraction"] & {
    method_detail?: string;
    selector_debug?: Record<string, string>;
    field_sources?: Record<string, string>;
    is_blocked?: boolean;
    ai_recovery_used?: boolean;
  };
};

interface AssistedResult {
  success: boolean;
  status: string;
  platform: string;
  listing_url: string | null;
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  seller_profile_signal: string | null;
  location: string | null;
  category: string | null;
  condition: string | null;
  listed_date_or_age: string | null;
  images: string[];
  risk_relevant_observations: string[];
  extraction: {
    confidence_score: number;
    confidence_band: string;
    method_used: string;
    fields_found: string[];
    fields_missing: string[];
    warnings: string[];
  };
  error: string | null;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "").replace("/bbge", "") + "/api/bbge";

const FIELD_SEVERITY: Record<string, { label: string; className: string }> = {
  price:       { label: "Critical", className: "bg-red-600/20 text-red-400 border-red-500/40" },
  seller_name: { label: "Critical", className: "bg-red-600/20 text-red-400 border-red-500/40" },
  images:      { label: "Critical", className: "bg-red-600/20 text-red-400 border-red-500/40" },
  location:    { label: "Important", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  description: { label: "Important", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  title:       { label: "Standard", className: "bg-muted/50 text-muted-foreground border-muted" },
};

export default function Home() {
  const { toast } = useToast();
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  // Assisted capture state
  const [showAssistedForm, setShowAssistedForm] = useState(false);
  const [assistedResult, setAssistedResult] = useState<AssistedResult | null>(null);
  const [isAssisting, setIsAssisting] = useState(false);
  const [assistedListingUrl, setAssistedListingUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [sellerText, setSellerText] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [screenshotPreviews, setScreenshotPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLoginWall = result?.status === "facebook_login_required";

  const { data: healthData, isLoading: isLoadingHealth } = useBbgeHealth();
  const extractMutation = useBbgeExtract();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { url: "" },
  });

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newB64: string[] = [];
    const newPreviews: string[] = [];
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        newB64.push(base64);
        newPreviews.push(dataUrl);
        if (newB64.length === files.length) {
          setScreenshots((prev) => [...prev, ...newB64]);
          setScreenshotPreviews((prev) => [...prev, ...newPreviews]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeScreenshot = (idx: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== idx));
    setScreenshotPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAssistedSubmit = async () => {
    const hasContent = !!(pastedText || sellerText || descriptionText || screenshots.length > 0);
    if (!hasContent) {
      toast({ title: "No content", description: "Please paste listing text or upload a screenshot.", variant: "destructive" });
      return;
    }
    setIsAssisting(true);
    setAssistedResult(null);
    try {
      const resp = await fetch(`${API_BASE}/assisted-facebook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingUrl: assistedListingUrl || undefined,
          pastedText: pastedText || undefined,
          sellerText: sellerText || undefined,
          descriptionText: descriptionText || undefined,
          screenshots: screenshots.length > 0 ? screenshots : undefined,
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json() as AssistedResult;
      setAssistedResult(data);
      toast({
        title: data.success ? "Assisted Capture Complete" : "Insufficient Evidence",
        description: data.success
          ? `Extracted with ${Math.round(data.extraction.confidence_score)}% confidence.`
          : "Not enough content to extract a useful listing. Try pasting more text.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Assisted Capture Failed", description: msg, variant: "destructive" });
    } finally {
      setIsAssisting(false);
    }
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    setResult(null);
    setShowDebug(false);
    setAssistedResult(null);
    setShowAssistedForm(false);
    extractMutation.mutate(
      { data: { url: values.url } },
      {
        onSuccess: (data) => {
          const r = data as ExtractResult;
          setResult(r);
          if (r.status === "facebook_login_required") {
            setAssistedListingUrl(values.url);
            toast({
              title: "Facebook Login Wall Detected",
              description: "Facebook requires login to view this listing. Use Assisted Capture to supply the listing details manually.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Extraction Complete",
              description: `Successfully extracted data from ${data.platform}.`,
            });
          }
        },
        onError: (error: any) => {
          toast({
            title: "Extraction Failed",
            description: error.response?.data?.error || error.message || "An unknown error occurred.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const getPlatformColor = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes("facebook")) return "bg-blue-500/10 text-blue-400 border-blue-500/30";
    if (p.includes("gumtree")) return "bg-green-500/10 text-green-400 border-green-500/30";
    if (p.includes("ebay")) return "bg-red-500/10 text-red-400 border-red-500/30";
    if (p.includes("craigslist")) return "bg-purple-500/10 text-purple-400 border-purple-500/30";
    return "bg-gray-500/10 text-gray-400 border-gray-500/30";
  };

  const getPlatformLabel = (platform: string) => {
    const labels: Record<string, string> = {
      ebay: "eBay",
      gumtree: "Gumtree",
      facebook: "Facebook Marketplace",
      craigslist: "Craigslist",
      generic: "Generic",
    };
    return labels[platform.toLowerCase()] ?? platform;
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 70) return "text-green-400";
    if (score >= 40) return "text-amber-400";
    return "text-red-400";
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard", description: "JSON data copied." });
  };

  const methodDetail = result?.extraction?.method_detail ?? result?.extraction?.method_used ?? "—";
  const selectorDebug = result?.extraction?.selector_debug ?? {};
  const hasSelectorDebug = Object.keys(selectorDebug).length > 0;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-mono selection:bg-primary/30 flex flex-col items-center py-12 px-4 sm:px-6 md:px-8">
      <div className="w-full max-w-5xl space-y-8">

        {/* Header */}
        <header className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                <Terminal size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  BBGE
                  <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    BuyBudi Generic Extractor
                  </span>
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2" data-testid="status-api">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-muted-foreground">API Ready</span>
              </div>
              {!isLoadingHealth && healthData && (
                <div className="flex items-center gap-2" data-testid="status-openai">
                  <div className={`h-2 w-2 rounded-full ${healthData.openaiConfigured ? "bg-primary" : "bg-amber-500"}`} />
                  <span className="text-muted-foreground">
                    OpenAI: {healthData.openaiConfigured ? "Connected" : "Skipped"}
                  </span>
                </div>
              )}
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            Paste a marketplace listing URL and BBGE will attempt to extract the listing data using platform-aware selectors and the best available method.
          </p>
        </header>

        {/* OpenAI Warning */}
        {!isLoadingHealth && healthData && !healthData.openaiConfigured && (
          <Alert variant="default" className="border-amber-500/50 bg-amber-500/10 text-amber-500">
            <AlertCircle className="h-4 w-4" color="currentColor" />
            <AlertTitle>Configuration Warning</AlertTitle>
            <AlertDescription>
              OPENAI_API_KEY is not configured. AI vision extraction has been skipped. Results may be less accurate for unsupported platforms.
            </AlertDescription>
          </Alert>
        )}

        {/* Input Panel */}
        <Card className="border-muted shadow-lg shadow-black/20">
          <CardContent className="pt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-4">
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <div className="relative">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input
                            placeholder="https://example.com/listing/..."
                            className="pl-10 h-12 text-base font-sans bg-input/50 border-muted focus-visible:ring-primary/50"
                            data-testid="input-url"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  size="lg"
                  disabled={extractMutation.isPending}
                  className="h-12 px-8 font-semibold w-full sm:w-auto"
                  data-testid="button-extract"
                >
                  {extractMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <SearchCode className="mr-2 h-5 w-5" />
                      Extract Listing
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Error State */}
        {extractMutation.isError && (
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
            <AlertCircle className="h-4 w-4" color="currentColor" />
            <AlertTitle>Extraction Failed</AlertTitle>
            <AlertDescription className="text-destructive/80 font-mono text-xs mt-2 break-all">
              {extractMutation.error?.message || "An unknown error occurred during extraction."}
            </AlertDescription>
          </Alert>
        )}

        {/* ───── Facebook Login Wall ───── */}
        {result && isLoginWall && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardContent className="pt-6 pb-6">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
                    <Lock className="h-5 w-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-blue-300 text-base mb-1">Facebook Login Wall Detected</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Facebook redirected the extractor to its login page — your listing is private or requires an account to view.
                      BBGE cannot bypass this. Instead, open the listing yourself and supply the content below.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-500/40 text-blue-300 hover:bg-blue-500/10 gap-2"
                        onClick={() => setShowAssistedForm((v) => !v)}
                      >
                        <FileText className="h-4 w-4" />
                        Paste Listing Details
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAssistedForm ? "rotate-180" : ""}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground gap-2"
                        onClick={() => {
                          setShowAssistedForm(true);
                          setTimeout(() => document.getElementById("assisted-pasted-text")?.focus(), 50);
                        }}
                      >
                        <MessageSquare className="h-4 w-4" />
                        Paste Page Text / HTML
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Assisted Capture Form */}
            {showAssistedForm && (
              <Card className="border-muted">
                <CardHeader className="pb-3 border-b border-muted">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                    <Upload className="h-4 w-4" />
                    Facebook Assisted Capture
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 space-y-5">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Open the listing in your browser while logged in to Facebook, then copy and paste the details below.
                    Optionally upload screenshots. The more content you provide, the higher the confidence score.
                  </p>

                  {/* Listing URL */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Listing URL</label>
                    <Input
                      value={assistedListingUrl}
                      onChange={(e) => setAssistedListingUrl(e.target.value)}
                      placeholder="https://www.facebook.com/marketplace/item/..."
                      className="font-sans text-sm bg-input/50 border-muted"
                    />
                  </div>

                  {/* Pasted text */}
                  <div className="space-y-1.5">
                    <label id="assisted-pasted-text" className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Pasted Listing Text or Page Source
                    </label>
                    <Textarea
                      value={pastedText}
                      onChange={(e) => setPastedText(e.target.value)}
                      placeholder="Paste the full text from the listing page here (Ctrl+A, Ctrl+C from the page, then paste). You can also paste raw HTML or page source."
                      className="min-h-[120px] font-sans text-sm bg-input/50 border-muted resize-y"
                    />
                  </div>

                  {/* Seller text */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Seller / Profile Info <span className="text-muted-foreground/50 normal-case tracking-normal">(optional)</span>
                    </label>
                    <Textarea
                      value={sellerText}
                      onChange={(e) => setSellerText(e.target.value)}
                      placeholder="Paste the seller's name and any profile details visible on the listing."
                      className="min-h-[64px] font-sans text-sm bg-input/50 border-muted resize-y"
                    />
                  </div>

                  {/* Description text */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Item Description <span className="text-muted-foreground/50 normal-case tracking-normal">(optional)</span>
                    </label>
                    <Textarea
                      value={descriptionText}
                      onChange={(e) => setDescriptionText(e.target.value)}
                      placeholder="Paste the item description text from the listing."
                      className="min-h-[80px] font-sans text-sm bg-input/50 border-muted resize-y"
                    />
                  </div>

                  {/* Screenshot upload */}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Screenshots <span className="text-muted-foreground/50 normal-case tracking-normal">(optional — improves AI extraction)</span>
                    </label>
                    <div
                      className="border border-dashed border-muted rounded-md p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
                      <p className="text-xs text-muted-foreground">Click to upload screenshots (PNG, JPG)</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        multiple
                        className="hidden"
                        onChange={handleScreenshotUpload}
                      />
                    </div>
                    {screenshotPreviews.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {screenshotPreviews.map((src, i) => (
                          <div key={i} className="relative group h-16 w-16 rounded-md overflow-hidden border border-muted bg-muted/30">
                            <img src={src} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover" />
                            <button
                              onClick={() => removeScreenshot(i)}
                              className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-destructive/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={handleAssistedSubmit}
                    disabled={isAssisting}
                    className="w-full font-semibold gap-2"
                  >
                    {isAssisting ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</>
                    ) : (
                      <><SearchCode className="h-4 w-4" /> Analyse Listing</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Assisted Capture Results */}
            {assistedResult && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                {!assistedResult.success && (
                  <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Insufficient Evidence</AlertTitle>
                    <AlertDescription className="text-amber-400/80 text-sm mt-1">
                      {assistedResult.extraction.warnings[0] ?? "Not enough content was supplied to extract a reliable listing. Add more text or screenshots."}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Diagnostics */}
                  <Card className="md:col-span-1 border-muted">
                    <CardHeader className="pb-3 border-b border-muted">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                        <Activity className="h-4 w-4" />
                        Diagnostics
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-5">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Platform</span>
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">Facebook Marketplace</Badge>
                      </div>
                      <div className="flex justify-between items-start text-sm gap-2">
                        <span className="text-muted-foreground shrink-0">Method</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">{assistedResult.extraction.method_used}</Badge>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground shrink-0">Source</span>
                        <Badge variant="outline" className="bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px] font-semibold">Assisted Capture</Badge>
                      </div>
                      <Separator className="bg-muted" />
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm mb-1">
                          <span className="text-muted-foreground">Confidence</span>
                          <span className={`font-bold text-base ${getConfidenceColor(assistedResult.extraction.confidence_score)}`}>
                            {Math.round(assistedResult.extraction.confidence_score)}%
                          </span>
                        </div>
                        <Progress value={assistedResult.extraction.confidence_score} className="h-2 bg-muted/50" />
                        <p className="text-[10px] text-muted-foreground">
                          Band: <span className="font-mono">{assistedResult.extraction.confidence_band}</span>
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Found</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {assistedResult.extraction.fields_found.map((f) => (
                              <Badge key={f} variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 text-xs font-mono">{f}</Badge>
                            ))}
                            {assistedResult.extraction.fields_found.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Missing</h4>
                          <div className="flex flex-wrap gap-1.5">
                            {assistedResult.extraction.fields_missing.map((f) => {
                              const sev = FIELD_SEVERITY[f];
                              return (
                                <div key={f} className="flex items-center gap-1">
                                  <Badge variant="outline" className={`text-xs font-mono ${sev ? sev.className : "bg-muted/50 text-muted-foreground border-muted"}`}>{f}</Badge>
                                  {sev && sev.label !== "Standard" && (
                                    <span className={`text-[9px] font-bold uppercase tracking-wider ${sev.label === "Critical" ? "text-red-500" : "text-amber-500"}`}>{sev.label}</span>
                                  )}
                                </div>
                              );
                            })}
                            {assistedResult.extraction.fields_missing.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                          </div>
                        </div>
                      </div>
                      {assistedResult.extraction.warnings.length > 0 && (
                        <div className="space-y-2 pt-1">
                          {assistedResult.extraction.warnings.map((w, i) => (
                            <div key={i} className="bg-amber-500/10 border border-amber-500/20 text-amber-500/90 text-xs p-2 rounded-md flex items-start gap-2">
                              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              <span>{w}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  {/* Listing Card */}
                  <Card className="md:col-span-2 border-muted overflow-hidden flex flex-col">
                    <CardHeader className="bg-muted/30 border-b border-muted pb-4">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="text-xl font-sans font-semibold text-white leading-tight break-words">
                            {assistedResult.title || <span className="text-muted-foreground italic font-normal">Untitled Listing</span>}
                          </div>
                          <div className="mt-2 flex items-center gap-3 flex-wrap">
                            {assistedResult.listing_url && (
                              <a href={assistedResult.listing_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
                                <ExternalLink className="h-3.5 w-3.5" />View Original
                              </a>
                            )}
                            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">Facebook Marketplace</Badge>
                            <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/30">Assisted Capture</Badge>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {assistedResult.price ? (
                            <div className="flex items-center gap-1.5">
                              <Tag className="h-4 w-4 text-primary" />
                              <span className="text-2xl font-bold text-primary font-sans">{assistedResult.price}</span>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground border-muted font-mono">price not found</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 flex-1">
                      <div className="grid grid-cols-2 divide-x divide-muted border-b border-muted">
                        <div className="p-4 space-y-1">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider">Seller</span>
                          <div className="font-medium text-sm">{assistedResult.seller_name || <span className="text-muted-foreground">Unknown</span>}</div>
                        </div>
                        <div className="p-4 space-y-1">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider">Location</span>
                          <div className="font-medium text-sm">{assistedResult.location || <span className="text-muted-foreground">Not specified</span>}</div>
                        </div>
                        <div className="p-4 space-y-1 border-t border-muted">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider">Category</span>
                          <div className="font-medium text-sm">{assistedResult.category || <span className="text-muted-foreground">Uncategorized</span>}</div>
                        </div>
                        <div className="p-4 space-y-1 border-t border-muted">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider">Condition</span>
                          <div className="font-medium text-sm">{assistedResult.condition || <span className="text-muted-foreground">Not specified</span>}</div>
                        </div>
                      </div>
                      {assistedResult.description && (
                        <div className="p-5">
                          <h4 className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Description</h4>
                          <div className="bg-muted/20 border border-muted rounded-md p-4 max-h-[200px] overflow-y-auto">
                            <p className="text-sm font-sans whitespace-pre-wrap text-foreground/80 leading-relaxed">{assistedResult.description}</p>
                          </div>
                        </div>
                      )}
                      {assistedResult.risk_relevant_observations.length > 0 && (
                        <div className="px-5 pb-5">
                          <h4 className="text-xs text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                            Risk Observations
                            <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">{assistedResult.risk_relevant_observations.length}</Badge>
                          </h4>
                          <ul className="space-y-1.5">
                            {assistedResult.risk_relevant_observations.map((obs, i) => (
                              <li key={i} className="text-xs text-red-400/90 flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded px-3 py-2">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                {obs}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {/* Copy JSON */}
                      <div className="px-5 pb-5">
                        <Button variant="outline" size="sm" className="gap-2 font-mono text-xs" onClick={() => copyToClipboard(JSON.stringify(assistedResult, null, 2))}>
                          <Clipboard className="h-3.5 w-3.5" />Copy JSON
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Normal Results */}
        {result && !isLoginWall && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Block / gate warning banner */}
            {result.extraction.is_blocked && (
              <Alert className="bg-orange-500/10 border-orange-500/30 text-orange-400">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="font-semibold">Page Blocked or Gated</AlertTitle>
                <AlertDescription className="text-orange-400/80 text-sm mt-1">
                  Marketplace page may be blocked or gated — the site returned a CAPTCHA, login prompt, or access-denied page. Extracted data may be incomplete.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              {/* Diagnostics Panel */}
              <Card className="md:col-span-1 border-muted">
                <CardHeader className="pb-3 border-b border-muted">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                    <Activity className="h-4 w-4" />
                    Diagnostics
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-5">

                  {/* Platform */}
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Platform</span>
                    <Badge variant="outline" className={getPlatformColor(result.platform)}>
                      {getPlatformLabel(result.platform)}
                    </Badge>
                  </div>

                  {/* Method detail */}
                  <div className="flex justify-between items-start text-sm gap-2">
                    <span className="text-muted-foreground shrink-0">Method</span>
                    <Badge variant="secondary" className="bg-secondary text-secondary-foreground font-mono text-[10px] text-right break-all max-w-[160px] whitespace-normal text-center">
                      {methodDetail}
                    </Badge>
                  </div>

                  {/* AI Recovery badge */}
                  {result.extraction.ai_recovery_used && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground shrink-0">Recovery</span>
                      <Badge variant="outline" className="bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px] font-semibold">
                        Recovered by AI Vision
                      </Badge>
                    </div>
                  )}

                  <Separator className="bg-muted" />

                  {/* Confidence score */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm mb-1">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className={`font-bold text-base ${getConfidenceColor(result.extraction.confidence_score)}`}>
                        {Math.round(result.extraction.confidence_score)}%
                      </span>
                    </div>
                    <Progress value={result.extraction.confidence_score} className="h-2 bg-muted/50" />
                  </div>

                  {/* Fields */}
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Found</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {result.extraction.fields_found.map((f: string) => (
                          <Badge key={f} variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 text-xs font-mono">
                            {f}
                          </Badge>
                        ))}
                        {result.extraction.fields_found.length === 0 && (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Missing</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {result.extraction.fields_missing.map((f: string) => {
                          const sev = FIELD_SEVERITY[f];
                          return (
                            <div key={f} className="flex items-center gap-1">
                              <Badge variant="outline" className={`text-xs font-mono ${sev ? sev.className : "bg-muted/50 text-muted-foreground border-muted"}`}>
                                {f}
                              </Badge>
                              {sev && sev.label !== "Standard" && (
                                <span className={`text-[9px] font-bold uppercase tracking-wider ${sev.label === "Critical" ? "text-red-500" : "text-amber-500"}`}>
                                  {sev.label}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {result.extraction.fields_missing.length === 0 && (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Warnings */}
                  {result.extraction.warnings.length > 0 && (
                    <div className="space-y-2 pt-1">
                      {result.extraction.warnings.map((w: string, i: number) => (
                        <div key={i} className="bg-amber-500/10 border border-amber-500/20 text-amber-500/90 text-xs p-2 rounded-md flex items-start gap-2">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Debug toggle */}
                  {hasSelectorDebug && (
                    <button
                      onClick={() => setShowDebug((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
                    >
                      <Bug className="h-3.5 w-3.5" />
                      {showDebug ? "Hide" : "Show"} selector debug
                    </button>
                  )}

                  {/* Debug panel — hidden by default */}
                  {showDebug && hasSelectorDebug && (
                    <div className="bg-[#0d1117] border border-muted/40 rounded-md p-3 space-y-1.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Matched Selectors</p>
                      {Object.entries(selectorDebug).map(([field, selector]) => (
                        <div key={field} className="flex items-start gap-2 text-[11px] font-mono">
                          <span className="text-green-400 shrink-0 w-20 truncate">{field}</span>
                          <span className="text-gray-400 break-all">{selector}</span>
                        </div>
                      ))}
                    </div>
                  )}

                </CardContent>
              </Card>

              {/* Listing Preview */}
              <Card className="md:col-span-2 border-muted overflow-hidden flex flex-col">
                {/* Title + Price bar */}
                <CardHeader className="bg-muted/30 border-b border-muted pb-4">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-xl font-sans font-semibold text-white leading-tight break-words">
                        {result.title || <span className="text-muted-foreground italic font-normal">Untitled Listing</span>}
                      </div>
                      <div className="mt-2 flex items-center gap-3 flex-wrap">
                        <a
                          href={result.listing_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          View Original
                        </a>
                        <Badge variant="outline" className={`text-[10px] ${getPlatformColor(result.platform)}`}>
                          {getPlatformLabel(result.platform)}
                        </Badge>
                      </div>
                    </div>
                    {/* Prominent price */}
                    <div className="shrink-0 text-right">
                      {result.price ? (
                        <div className="flex items-center gap-1.5">
                          <Tag className="h-4 w-4 text-primary" />
                          <span className="text-2xl font-bold text-primary font-sans">
                            {result.price}
                          </span>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground border-muted font-mono">
                          price not found
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0 flex-1">
                  {/* Metadata grid */}
                  <div className="grid grid-cols-2 divide-x divide-muted border-b border-muted">
                    <div className="p-4 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Seller</span>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {result.seller_name || <span className="text-muted-foreground">Unknown</span>}
                        {result.seller_profile_url && (
                          <a href={result.seller_profile_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Location</span>
                      <div className="font-medium text-sm">{result.location || <span className="text-muted-foreground">Not specified</span>}</div>
                    </div>
                    <div className="p-4 space-y-1 border-t border-muted">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Category</span>
                      <div className="font-medium text-sm">{result.category || <span className="text-muted-foreground">Uncategorized</span>}</div>
                    </div>
                    <div className="p-4 space-y-1 border-t border-muted">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Condition</span>
                      <div className="font-medium text-sm">{result.condition || <span className="text-muted-foreground">Not specified</span>}</div>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="p-5">
                    <h4 className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Description</h4>
                    <div className="bg-muted/20 border border-muted rounded-md p-4 max-h-[200px] overflow-y-auto">
                      <p className="text-sm font-sans whitespace-pre-wrap text-foreground/80 leading-relaxed">
                        {result.description || <span className="italic text-muted-foreground">No description extracted.</span>}
                      </p>
                    </div>
                  </div>

                  {/* Images */}
                  {result.images && result.images.length > 0 && (
                    <div className="px-5 pb-5">
                      <h4 className="text-xs text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                        Images
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{result.images.length}</Badge>
                      </h4>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {result.images.slice(0, 6).map((img: string, i: number) => (
                          <a
                            key={i}
                            href={img}
                            target="_blank"
                            rel="noreferrer"
                            className="block aspect-square rounded-md overflow-hidden border border-muted hover:border-primary transition-colors relative group bg-muted/50"
                          >
                            <img src={img} alt={`Listing image ${i + 1}`} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ExternalLink className="h-4 w-4 text-white" />
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Evidence Panel */}
            <Card className="border-muted bg-card">
              <Collapsible>
                <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors [&[data-state=open]>svg]:rotate-90">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <SearchCode className="h-4 w-4 text-primary" />
                    Extraction Evidence
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4 border-t border-muted pt-4 space-y-6">
                  {result.evidence.screenshot_url ? (
                    <div className="space-y-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Screenshot</span>
                      <div className="rounded-md border border-muted overflow-hidden max-h-[400px] overflow-y-auto bg-muted/20">
                        <img src={result.evidence.screenshot_url} alt="Page screenshot" className="w-full object-contain" />
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">No screenshot available for this extraction.</div>
                  )}
                  {result.evidence.html_excerpt && (
                    <div className="space-y-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">HTML Excerpt</span>
                      <pre className="bg-[#0d1117] border border-muted text-gray-300 text-xs p-4 rounded-md overflow-x-auto max-h-[300px]">
                        <code>{result.evidence.html_excerpt}</code>
                      </pre>
                    </div>
                  )}
                  {result.evidence.visible_text_excerpt && (
                    <div className="space-y-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Visible Text</span>
                      <pre className="bg-[#0d1117] border border-muted text-gray-300 text-xs p-4 rounded-md overflow-x-auto max-h-[300px] whitespace-pre-wrap">
                        {result.evidence.visible_text_excerpt}
                      </pre>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </Card>

            {/* Raw JSON */}
            <Card className="border-muted bg-[#0d1117]">
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors [&[data-state=open]>svg]:rotate-90">
                  <div className="flex items-center gap-2 font-semibold text-sm text-gray-300">
                    <Server className="h-4 w-4 text-primary" />
                    Raw Normalized JSON
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4 border-t border-muted/30 pt-4">
                  <div className="relative group">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8"
                      onClick={() => copyToClipboard(JSON.stringify(result, null, 2))}
                    >
                      <Clipboard className="h-4 w-4 mr-2" />
                      Copy
                    </Button>
                    <pre className="text-xs text-[#a5d6ff] font-mono overflow-x-auto p-4 rounded bg-[#0d1117] border border-muted/50 max-h-[500px] overflow-y-auto">
                      <code>{JSON.stringify(result, null, 2)}</code>
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>

          </div>
        )}
      </div>
    </div>
  );
}
