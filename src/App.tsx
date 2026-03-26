import React, { useState, useRef, useEffect } from "react";
import { Search, Globe, Tag, Camera, ExternalLink, Copy, Check, AlertCircle, Loader2, Download, Scissors, Maximize2, X, Save, Code, Monitor, Smartphone, Clock, Shield } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop, PixelCrop } from "react-image-crop";

interface TestResult {
  success: boolean;
  title: string;
  finalUrl: string;
  screenshot: string;
  detectedTags: string[];
}

export default function App() {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<"snippet" | "url">("snippet");
  const [deviceType, setDeviceType] = useState<"desktop" | "mobile">("desktop");
  
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Initializing analyzer...");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [screenshotAction, setScreenshotAction] = useState<"none" | "copy" | "save" | "crop">("none");
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [activeTab, setActiveTab] = useState<"screenshot" | "preview">("screenshot");
  const screenshotRef = useRef<HTMLImageElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "url" && !url) return;
    if (mode === "snippet" && !html) return;

    let formattedUrl = url;
    if (mode === "url" && !/^https?:\/\//i.test(url)) {
      formattedUrl = `https://${url}`;
    }

    setLoading(true);
    setStatusMessage("Checking server status...");
    setError(null);
    setResult(null);

    let statusInterval: any;

    try {
      // Check if server is reachable with retries
      let healthCheck = null;
      for (let i = 0; i < 3; i++) {
        try {
          healthCheck = await fetch("/api/health", { signal: AbortSignal.timeout(5000) });
          if (healthCheck.ok) break;
        } catch (e) {
          console.warn(`Health check attempt ${i + 1} failed`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!healthCheck || !healthCheck.ok) {
        throw new Error("The analysis server is not responding. This can happen if it's still starting up. Please wait 10 seconds and try again.");
      }

      setStatusMessage("Launching browser...");

      statusInterval = setInterval(() => {
        const messages = [
          "Navigating to content...",
          "Waiting for network idle...",
          "Detecting marketing tags...",
          "Capturing screenshot...",
          "Finalizing results...",
        ];
        setStatusMessage((prev) => {
          const currentIndex = messages.indexOf(prev);
          if (currentIndex < messages.length - 1) return messages[currentIndex + 1];
          return prev;
        });
      }, 3000);

      const payload = mode === "url" 
        ? { url: formattedUrl, deviceType } 
        : { html, deviceType };

      const response = await fetch("/api/test-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000), // 60 second timeout for analysis
      });

      
      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error("Non-JSON response received:", text);
        throw new Error(`The analysis server is currently overloaded or unavailable (Status: ${response.status}). Please try again in a few moments.`);
      }

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Failed to analyze the content. Please check your input and try again.");
      }
    } catch (err: any) {
      let errorMessage = "A network error occurred. Please make sure the server is running.";
      if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.includes('aborted')) {
        errorMessage = "The analysis timed out. The website might be too slow or blocking our automated browser.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      console.error(err);
    } finally {
      if (statusInterval) clearInterval(statusInterval);
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadScreenshot = () => {
    if (!result?.screenshot) return;
    const link = document.createElement("a");
    link.href = result.screenshot;
    link.download = `tag-tester-screenshot-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyImageToClipboard = async () => {
    if (!result?.screenshot) return;
    try {
      const response = await fetch(result.screenshot);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      setScreenshotAction("copy");
      setTimeout(() => setScreenshotAction("none"), 2000);
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const initialCrop = centerCrop(
      makeAspectCrop(
        {
          unit: '%',
          width: 90,
        },
        1,
        width,
        height
      ),
      width,
      height
    );
    setCrop(initialCrop);
  };

  const saveCrop = async () => {
    if (!completedCrop || !imgRef.current || !result) return;

    const image = imgRef.current;
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = completedCrop.width * scaleX;
    canvas.height = completedCrop.height * scaleY;

    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY
    );

    const base64Image = canvas.toDataURL('image/png');
    setResult({ ...result, screenshot: base64Image });
    setIsCropping(false);
    setScreenshotAction("save");
    setTimeout(() => setScreenshotAction("none"), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500 selection:text-black flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <Tag className="text-black w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight uppercase">Tag Tester</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 flex-1 w-full flex flex-col">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
          {/* Left Column: Input & Options */}
          <div className="lg:col-span-4 space-y-6 flex flex-col">
            {/* Mode Switcher */}
            <div className="bg-white/5 p-1 rounded-xl border border-white/10 flex gap-1">
              <button
                onClick={() => setMode("snippet")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === "snippet" ? "bg-orange-500 text-black" : "text-white/40 hover:text-white"}`}
              >
                <Code className="w-4 h-4" />
                Snippet Mode (Default)
              </button>
              <button
                onClick={() => setMode("url")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === "url" ? "bg-orange-500 text-black" : "text-white/40 hover:text-white"}`}
              >
                <Globe className="w-4 h-4" />
                URL Mode
              </button>
            </div>

            <form onSubmit={handleTest} className="flex flex-col flex-1 space-y-6">
              {mode === "snippet" ? (
                <div className="flex-1 flex flex-col">
                  <label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">HTML Snippet</label>
                  <textarea
                    placeholder="Paste your HTML tag snippet here (e.g., <script>...</script>)"
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                    className="w-full flex-1 bg-white/5 border border-white/10 rounded-2xl py-4 px-4 text-sm focus:outline-none focus:border-orange-500/50 focus:bg-white/10 transition-all placeholder:text-white/20 min-h-[200px] font-mono resize-none"
                    disabled={loading}
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">Target URL</label>
                  <div className="relative flex items-center">
                    <div className="absolute left-4 text-white/40">
                      <Search className="w-5 h-5" />
                    </div>
                    <input
                      type="text"
                      placeholder="https://example.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:border-orange-500/50 focus:bg-white/10 transition-all placeholder:text-white/20"
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              {/* Advanced Options */}
              <div className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">Test Options</h3>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/80 flex items-center gap-2">
                      <Monitor className="w-4 h-4" /> Device
                    </span>
                    <div className="flex bg-black/40 rounded-lg border border-white/5 p-1">
                      <button type="button" onClick={() => setDeviceType("desktop")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${deviceType === "desktop" ? "bg-white/20 text-white" : "text-white/40 hover:text-white"}`}>Desktop</button>
                      <button type="button" onClick={() => setDeviceType("mobile")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${deviceType === "mobile" ? "bg-white/20 text-white" : "text-white/40 hover:text-white"}`}>Mobile</button>
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || (mode === "url" ? !url : !html)}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-white/10 disabled:text-white/20 text-black font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {statusMessage}
                  </>
                ) : (
                  "Run Audit"
                )}
              </button>
            </form>
          </div>

          {/* Right Column: Preview & Results */}
          <div className="lg:col-span-8 flex flex-col h-full min-h-[600px]">
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="mb-6 bg-red-500/10 border border-red-500/20 rounded-2xl p-6 flex items-start gap-4 text-red-400"
                >
                  <AlertCircle className="w-6 h-6 shrink-0" />
                  <div>
                    <h3 className="font-bold mb-1">Analysis Failed</h3>
                    <p className="text-sm opacity-80">{error}</p>
                  </div>
                </motion.div>
              )}

              {!result && !error && !loading && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex-1 border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-white/20 p-8 text-center"
                >
                  <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4">
                    <Tag className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-white/40">Ready to Audit</h3>
                  <p className="max-w-md">Enter a URL or paste an HTML snippet on the left to begin analyzing your marketing tags.</p>
                </motion.div>
              )}

              {loading && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 border border-white/10 rounded-3xl flex flex-col items-center justify-center bg-white/5 p-8 text-center"
                >
                  <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-6" />
                  <h3 className="text-xl font-bold mb-2">Analyzing Content</h3>
                  <p className="text-white/60">{statusMessage}</p>
                </motion.div>
              )}

              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col h-full space-y-6"
                >
                  {/* Results Header Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1 block">Detected Tags</label>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-orange-500">{result.detectedTags.length}</span>
                        <span className="text-sm text-white/60">found</span>
                      </div>
                      {result.detectedTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {result.detectedTags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-[10px] bg-white/10 px-2 py-1 rounded-md">{tag}</span>
                          ))}
                          {result.detectedTags.length > 3 && (
                            <span className="text-[10px] bg-white/10 px-2 py-1 rounded-md">+{result.detectedTags.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col justify-center">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1 block">Destination</label>
                      <div className="flex items-center gap-2 group">
                        <span className="text-sm truncate text-white/80 flex-1">{result.finalUrl}</span>
                        {result.finalUrl.startsWith('http') && (
                          <button 
                            onClick={() => copyToClipboard(result.finalUrl)}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                          >
                            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Visual Output Area */}
                  <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-4 flex flex-col min-h-[400px]">
                    <div className="flex items-center justify-between mb-4 px-2">
                      <div className="flex items-center gap-2 bg-black/40 p-1 rounded-xl border border-white/5">
                        <button
                          onClick={() => setActiveTab("screenshot")}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === "screenshot" ? "bg-white/10 text-orange-500" : "text-white/40 hover:text-white"}`}
                        >
                          <Camera className="w-4 h-4" />
                          Screenshot
                        </button>
                        <button
                          onClick={() => setActiveTab("preview")}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === "preview" ? "bg-white/10 text-orange-500" : "text-white/40 hover:text-white"}`}
                        >
                          <Globe className="w-4 h-4" />
                          Live Preview
                        </button>
                      </div>
                      
                      <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                        {activeTab === "preview" ? (
                          result.finalUrl.startsWith('http') && (
                            <a 
                              href={result.finalUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                              title="Open Live Site"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Open
                            </a>
                          )
                        ) : isCropping ? (
                          <>
                            <button
                              onClick={saveCrop}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative text-green-500"
                              title="Save Crop"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setIsCropping(false)}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative text-red-500"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setIsCropping(true)}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative"
                              title="Crop Image"
                            >
                              <Scissors className="w-4 h-4 text-white/40 group-hover:text-white" />
                            </button>
                            <button
                              onClick={copyImageToClipboard}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative"
                              title="Copy Image"
                            >
                              {screenshotAction === "copy" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-white/40 group-hover:text-white" />}
                            </button>
                            <button
                              onClick={downloadScreenshot}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative"
                              title="Download Image"
                            >
                              <Download className="w-4 h-4 text-white/40 group-hover:text-white" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex-1 relative rounded-2xl overflow-hidden border border-white/5 bg-black flex items-center justify-center">
                      <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
                        {activeTab === "preview" ? (
                          <iframe 
                            src={mode === "url" ? url : undefined}
                            srcDoc={mode === "snippet" ? `<base target="_blank" />${html}` : undefined}
                            className="w-full h-full bg-white rounded-xl border-0"
                            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
                            title="Live Preview"
                          />
                        ) : isCropping ? (
                          <ReactCrop
                            crop={crop}
                            onChange={(c) => setCrop(c)}
                            onComplete={(c) => setCompletedCrop(c)}
                            className="max-w-full"
                          >
                            <img 
                              ref={imgRef}
                              src={result.screenshot} 
                              alt="Crop Preview" 
                              onLoad={onImageLoad}
                              className="max-w-full h-auto object-contain"
                              referrerPolicy="no-referrer"
                            />
                          </ReactCrop>
                        ) : (
                          <img 
                            ref={screenshotRef}
                            src={result.screenshot} 
                            alt="Page Screenshot" 
                            className="max-w-full h-auto object-contain shadow-2xl"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Full Tags List (if many) */}
                  {result.detectedTags.length > 3 && (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3">All Detected Tags</h4>
                      <div className="flex flex-wrap gap-2">
                        {result.detectedTags.map((tag) => (
                          <div 
                            key={tag}
                            className="bg-white/10 border border-white/5 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2"
                          >
                            <div className="w-1.5 h-1.5 bg-orange-500 rounded-full" />
                            {tag}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

