import React, { useState } from "react";
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
} from "lucide-react";

import { useBbgeHealth, useBbgeExtract, type BbgeExtractResult } from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  url: z.string().url({ message: "Please enter a valid URL." }),
});

export default function Home() {
  const { toast } = useToast();
  const [result, setResult] = useState<BbgeExtractResult | null>(null);

  const { data: healthData, isLoading: isLoadingHealth } = useBbgeHealth();
  const extractMutation = useBbgeExtract();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "",
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    setResult(null);
    extractMutation.mutate(
      { data: { url: values.url } },
      {
        onSuccess: (data) => {
          setResult(data);
          toast({
            title: "Extraction Complete",
            description: `Successfully extracted data from ${data.platform}.`,
          });
        },
        onError: (error: any) => {
          toast({
            title: "Extraction Failed",
            description: error.response?.data?.error || error.message || "An unknown error occurred.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const getPlatformColor = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes("facebook")) return "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/20";
    if (p.includes("gumtree")) return "bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20";
    if (p.includes("ebay")) return "bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20";
    if (p.includes("craigslist")) return "bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 border-purple-500/20";
    return "bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 border-gray-500/20";
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "JSON data copied.",
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-mono selection:bg-primary/30 flex flex-col items-center py-12 px-4 sm:px-6 md:px-8">
      <div className="w-full max-w-5xl space-y-8">
        
        {/* Header */}
        <header className="space-y-4">
          <div className="flex items-center justify-between">
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
                  <div className={`h-2 w-2 rounded-full ${healthData.openaiConfigured ? 'bg-primary' : 'bg-amber-500'}`} />
                  <span className="text-muted-foreground">
                    OpenAI: {healthData.openaiConfigured ? "Connected" : "Skipped"}
                  </span>
                </div>
              )}
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            Paste a marketplace listing URL and BBGE will attempt to extract the listing data using the best available method for that platform. Built for precision.
          </p>
        </header>

        {/* Warning Banner */}
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

        {/* Results Area */}
        {result && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Extraction Summary */}
              <Card className="md:col-span-1 border-muted">
                <CardHeader className="pb-3 border-b border-muted">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                    <Activity className="h-4 w-4" />
                    Diagnostics
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-6">
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Platform</span>
                      <Badge variant="outline" className={getPlatformColor(result.platform)}>
                        {result.platform}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className="font-semibold">{Math.round(result.platform_confidence)}%</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Method</span>
                      <Badge variant="secondary" className="bg-secondary text-secondary-foreground font-mono text-xs">
                        {result.extraction.method_used}
                      </Badge>
                    </div>
                  </div>

                  <Separator className="bg-muted" />

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm mb-1">
                      <span className="text-muted-foreground">Extraction Score</span>
                      <span className="font-semibold text-primary">{Math.round(result.extraction.confidence_score)}%</span>
                    </div>
                    <Progress value={result.extraction.confidence_score} className="h-2 bg-muted/50" />
                  </div>

                  <div className="space-y-3">
                    <div>
                      <h4 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Fields Found</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {result.extraction.fields_found.map((f: string) => (
                          <Badge key={f} variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 text-xs font-mono">
                            {f}
                          </Badge>
                        ))}
                        {result.extraction.fields_found.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider mt-4">Fields Missing</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {result.extraction.fields_missing.map((f: string) => (
                          <Badge key={f} variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-xs font-mono">
                            {f}
                          </Badge>
                        ))}
                        {result.extraction.fields_missing.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                      </div>
                    </div>
                  </div>

                  {result.extraction.warnings.length > 0 && (
                    <div className="space-y-2 pt-2">
                      {result.extraction.warnings.map((w: string, i: number) => (
                        <div key={i} className="bg-amber-500/10 border border-amber-500/20 text-amber-500/90 text-xs p-2 rounded-md flex items-start gap-2">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                </CardContent>
              </Card>

              {/* Listing Preview */}
              <Card className="md:col-span-2 border-muted overflow-hidden flex flex-col">
                <CardHeader className="bg-muted/30 border-b border-muted pb-4">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <CardTitle className="text-xl font-sans text-white leading-tight">
                        {result.title || <span className="text-muted-foreground italic">Untitled Listing</span>}
                      </CardTitle>
                      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <a href={result.listing_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                          <ExternalLink className="h-3.5 w-3.5" />
                          View Original
                        </a>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-primary shrink-0">
                      {result.price || 'No Price'}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0 flex-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-muted border-b border-muted">
                    <div className="p-4 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Seller</span>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {result.seller_name || 'Unknown'}
                        {result.seller_profile_url && (
                          <a href={result.seller_profile_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="p-4 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Location</span>
                      <div className="font-medium text-sm">{result.location || 'Not specified'}</div>
                    </div>
                    <div className="p-4 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Category</span>
                      <div className="font-medium text-sm">{result.category || 'Uncategorized'}</div>
                    </div>
                    <div className="p-4 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Condition</span>
                      <div className="font-medium text-sm">{result.condition || 'Not specified'}</div>
                    </div>
                  </div>

                  <div className="p-6">
                    <h4 className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Description</h4>
                    <div className="bg-muted/20 border border-muted rounded-md p-4 max-h-[200px] overflow-y-auto">
                      <p className="text-sm font-sans whitespace-pre-wrap text-foreground/80">
                        {result.description || <span className="italic text-muted-foreground">No description provided.</span>}
                      </p>
                    </div>
                  </div>

                  {result.images && result.images.length > 0 && (
                    <div className="p-6 pt-0">
                      <h4 className="text-xs text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                        Images <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{result.images.length}</Badge>
                      </h4>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {result.images.slice(0, 6).map((img: string, i: number) => (
                          <a key={i} href={img} target="_blank" rel="noreferrer" className="block aspect-square rounded-md overflow-hidden border border-muted hover:border-primary transition-colors relative group bg-muted/50">
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

            {/* Evidence Card */}
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
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">HTML Excerpt (Relevant fragments)</span>
                      <div className="relative">
                        <pre className="bg-[#0d1117] border border-muted text-gray-300 text-xs p-4 rounded-md overflow-x-auto max-h-[300px]">
                          <code>{result.evidence.html_excerpt}</code>
                        </pre>
                      </div>
                    </div>
                  )}
                  
                  {result.evidence.visible_text_excerpt && (
                    <div className="space-y-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Visible Text</span>
                      <div className="relative">
                        <pre className="bg-[#0d1117] border border-muted text-gray-300 text-xs p-4 rounded-md overflow-x-auto max-h-[300px] whitespace-pre-wrap">
                          {result.evidence.visible_text_excerpt}
                        </pre>
                      </div>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </Card>

            {/* Raw JSON Card */}
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
                    <pre className="text-xs text-[#a5d6ff] font-mono overflow-x-auto p-4 rounded bg-[#0d1117] border border-muted/50 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted">
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
