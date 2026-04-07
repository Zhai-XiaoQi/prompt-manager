import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, Plus, Download, Upload, Save, Copy, Edit, Trash2, 
  Image as ImageIcon, Hash, Moon, Sun, Check, Folder, Database,
  AlertCircle, X, ChevronRight, LayoutGrid, Maximize, Github
} from 'lucide-react';

const MD_FENCE = '`' + '`' + '`';

const INITIAL_DATA = [
  {
    id: 'p-1',
    title: '赛博朋克头像生成',
    prompt: MD_FENCE + "text\n" +
            "[English Prompt]\n" +
            "A highly detailed portrait of a futuristic cyberpunk hacker, neon lights, 8k resolution, octane render --ar 1:1\n\n" +
            "[Chinese Prompt]\n" +
            "一个未来赛博朋克黑客的高清特写肖像，霓虹灯光，8k分辨率，octane渲染 --ar 1:1\n" +
            MD_FENCE,
    cover: '', 
    tags: ['Midjourney', '头像', '赛博朋克'],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

export default function App() {
  const [prompts, setPrompts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, id: null });

  useEffect(() => {
    const saved = localStorage.getItem('prompt-manager-cache');
    if (saved) {
      try {
        setPrompts(JSON.parse(saved));
      } catch (e) {
        setPrompts(INITIAL_DATA);
      }
    } else {
      setPrompts(INITIAL_DATA);
    }
    
    // 强制默认亮主题，移除跟随系统暗黑模式的自动切换
    setDarkMode(false);
  }, []);

  useEffect(() => {
    if (prompts.length > 0) {
      localStorage.setItem('prompt-manager-cache', JSON.stringify(prompts));
    }
  }, [prompts]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const extractTags = (text) => {
    const matches = text.match(/#[\p{L}\d_]+/gu);
    return matches ? [...new Set(matches.map(t => t.slice(1)))] : [];
  };

  const handleSavePrompt = (promptData) => {
    const extractedTags = extractTags(promptData.prompt);
    const combinedTags = [...new Set([...promptData.tags, ...extractedTags])];
    
    const finalData = { ...promptData, tags: combinedTags, updatedAt: Date.now() };

    if (finalData.id) {
      setPrompts(prev => prev.map(p => p.id === finalData.id ? finalData : p));
    } else {
      finalData.id = 'p-' + Date.now().toString(36);
      finalData.createdAt = Date.now();
      setPrompts(prev => [finalData, ...prev]);
    }
    
    setIsDirty(true);
    setIsModalOpen(false);
    showToast('提示词已保存至工作区');
  };

  const handleDelete = (id) => {
    setConfirmDialog({ isOpen: true, id });
  };

  const executeDelete = () => {
    if (confirmDialog.id) {
      setPrompts(prev => prev.filter(p => p.id !== confirmDialog.id));
      setIsDirty(true);
      showToast('已成功删除');
    }
    setConfirmDialog({ isOpen: false, id: null });
  };

  const handleCopy = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        showToast('内容已完整复制到剪贴板');
      } else {
        showToast('复制失败，请手动复制', 'error');
      }
    } catch (err) {
      showToast('复制报错，请手动复制', 'error');
    }
    document.body.removeChild(textArea);
  };

  const handleDuplicate = (prompt) => {
    const newPrompt = {
      ...prompt,
      id: 'p-' + Date.now().toString(36),
      title: prompt.title + ' (副本)',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    setPrompts(prev => [newPrompt, ...prev]);
    setIsDirty(true);
    showToast('已创建副本');
  };

  const handleExportJSON = () => {
    const dataStr = JSON.stringify(prompts, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'prompt-manager-db.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    setIsDirty(false);
    setLastSyncTime(Date.now());
    showToast('仓库数据已导出到本地');
  };

  const handleImportJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          setPrompts(imported);
          setIsDirty(false);
          setLastSyncTime(Date.now());
          showToast('成功导入仓库数据');
        } else {
          showToast('数据格式错误，请检查文件', 'error');
        }
      } catch (err) {
        showToast('无法解析 JSON 文件', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const allTags = useMemo(() => {
    const tagMap = {};
    prompts.forEach(p => {
      p.tags.forEach(t => {
        tagMap[t] = (tagMap[t] || 0) + 1;
      });
    });
    return Object.entries(tagMap).sort((a, b) => b[1] - a[1]);
  }, [prompts]);

  const filteredPrompts = useMemo(() => {
    return prompts.filter(p => {
      const matchSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.prompt.toLowerCase().includes(searchQuery.toLowerCase());
      const matchTags = selectedTags.length === 0 || selectedTags.every(t => p.tags.includes(t));
      return matchSearch && matchTags;
    });
  }, [prompts, searchQuery, selectedTags]);

  const toggleTag = (tag) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  // 高级质感主题配色
  const outerBg = darkMode ? 'bg-black' : 'bg-[#E5E5EA]'; 
  const themeAppBg = darkMode ? 'bg-[#0A0A0B] text-gray-100 border-white/5' : 'bg-[#F2F2F7] text-[#1D1D1F] border-black/5';
  const themeSidebar = darkMode ? 'bg-[#141415]/80 border-white/5' : 'bg-[#FFFFFF]/80 border-black/5';
  const themeCard = darkMode ? 'bg-[#1C1C1E] border-white/5 shadow-md hover:border-white/20 hover:shadow-2xl' : 'bg-white border-black/5 shadow-sm hover:border-black/10 hover:shadow-xl';
  const themeInput = darkMode ? 'bg-[#1C1C1E] border-white/10 text-white placeholder-gray-500 focus:ring-white/30' : 'bg-[#F2F2F7] border-black/5 text-black placeholder-gray-400 focus:ring-black/20';
  const codeBg = darkMode ? 'bg-[#141415] border-white/5 hover:border-white/20 text-gray-300' : 'bg-[#F8F9FA] border-black/5 hover:border-black/15 text-gray-600';

  return (
    <div className={`flex justify-center w-full h-screen transition-colors duration-300 ${outerBg}`}>
      <div className={`flex h-full w-full max-w-[1600px] font-sans overflow-hidden transition-colors duration-300 border-x relative ${themeAppBg}`}>
        
        {/* --- 左侧栏 --- */}
        <aside className={`w-72 flex flex-col border-r backdrop-blur-2xl transition-colors duration-300 ${themeSidebar} z-10 relative shrink-0`}>
          <div className="p-8 pb-6 flex items-center justify-between">
            <h1 className="text-2xl font-black tracking-tighter flex items-center gap-2">
              <LayoutGrid className="w-6 h-6" />
              ZenPrompt.
            </h1>
          </div>

          <div className="px-6 mb-8">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-3 flex items-center justify-between px-2">
              <span>工作区状态</span>
              {isDirty && <span className="flex items-center gap-1 text-[#FF453A] animate-pulse" title="有未保存的修改"><AlertCircle className="w-3 h-3"/></span>}
            </div>
            <div className={`p-4 rounded-xl transition-colors ${darkMode ? 'bg-[#2C2C2E]' : 'bg-[#F2F2F7]'}`}>
              <div className="flex items-center gap-3 font-medium text-sm">
                <div className="w-8 h-8 rounded-lg bg-black dark:bg-white text-white dark:text-black flex items-center justify-center">
                  <Folder className="w-4 h-4" />
                </div>
                <div className="flex-1 truncate">
                  <p className="truncate font-bold">本地默认仓库</p>
                  {lastSyncTime && <p className="text-[10px] text-gray-400 font-normal">最近同步: {new Date(lastSyncTime).toLocaleTimeString()}</p>}
                </div>
              </div>
              <button 
                onClick={handleExportJSON}
                className={`mt-4 w-full py-2.5 px-4 text-sm rounded-lg font-bold transition-all flex items-center justify-center gap-2
                  ${isDirty ? 'bg-[#FF453A] hover:bg-[#FF3B30] text-white shadow-lg shadow-red-500/20' : (darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10')}
                `}
              >
                <Save className="w-4 h-4" />
                保存到本地
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 hide-scrollbar">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-4 px-2">
              标签检索 ({allTags.length})
            </div>
            <div className="flex flex-col gap-2">
              {allTags.map(([tag, count]) => {
                const isActive = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm transition-all text-left font-medium
                      ${isActive 
                        ? 'bg-black text-white dark:bg-white dark:text-black shadow-md' 
                        : 'hover:bg-black/5 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300'}
                    `}
                  >
                    <div className="flex items-center gap-3 truncate">
                      <Hash className={`w-4 h-4 ${isActive ? 'opacity-100' : 'opacity-40'}`} />
                      <span className="truncate">{tag}</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold
                      ${isActive ? 'bg-white/20 dark:bg-black/20' : 'bg-black/5 dark:bg-white/10'}
                    `}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 底部控制栏 */}
          <div className="p-6 mt-auto">
            <div className={`flex items-center justify-between p-2 rounded-xl ${darkMode ? 'bg-[#2C2C2E]' : 'bg-[#F2F2F7]'}`}>
              <span className="text-xs font-semibold text-gray-500 px-4">共 {prompts.length} 个项目</span>
              <div className="flex items-center gap-1.5">
                <a 
                  href="https://github.com/Zhai-XiaoQi/prompt-manager" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-2.5 rounded-lg bg-white dark:bg-black shadow-sm text-gray-600 dark:text-gray-300 hover:opacity-80 transition-opacity flex items-center justify-center"
                  title="访问 GitHub 源码"
                >
                  <Github className="w-4 h-4" />
                </a>
                <button 
                  onClick={() => setDarkMode(!darkMode)}
                  className="p-2.5 rounded-lg bg-white dark:bg-black shadow-sm text-gray-600 dark:text-gray-300 hover:opacity-80 transition-opacity flex items-center justify-center"
                  title="切换主题"
                >
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* --- 主内容区 --- */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          
          <header className="h-24 flex items-center justify-between px-10 shrink-0 z-10">
            <div className="relative flex-1 max-w-[480px]">
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="搜索标题、内容或标签..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full pl-11 pr-6 py-3 rounded-xl border-2 outline-none transition-all font-medium ${themeInput}`}
              />
            </div>

            <div className="flex items-center gap-4 ml-6">
              <div className="flex items-center bg-black/5 dark:bg-white/10 rounded-xl p-1">
                <label className="cursor-pointer flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-lg hover:bg-white dark:hover:bg-black hover:shadow-sm transition-all">
                  <Upload className="w-4 h-4" />
                  <span>导入</span>
                  <input type="file" accept=".json" className="hidden" onChange={handleImportJSON} />
                </label>
                <button
                  onClick={handleExportJSON}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-lg hover:bg-white dark:hover:bg-black hover:shadow-sm transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>导出</span>
                </button>
              </div>
              
              <button
                onClick={() => {
                  setEditingPrompt(null);
                  setIsModalOpen(true);
                }}
                className="flex items-center gap-2 px-6 py-3 bg-[#FF6B00] hover:bg-[#E66000] text-white text-sm font-bold rounded-xl shadow-lg shadow-orange-500/30 transition-all"
              >
                <Plus className="w-5 h-5" />
                新建
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-10 pb-10 pt-4 hide-scrollbar">
            {filteredPrompts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <Database className="w-16 h-16 mb-6 opacity-20" />
                <h2 className="text-2xl font-bold text-gray-500 mb-2">暂无数据</h2>
                <p className="text-sm">从零开始，尝试创建你的第一个提示词吧。</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 content-start transition-all duration-300">
                {filteredPrompts.map(prompt => (
                  <div 
                    key={prompt.id} 
                    className={`group rounded-2xl border overflow-hidden flex flex-col transition-all duration-300 ease-out ${themeCard}`}
                  >
                    <div className="aspect-[16/10] bg-[#F2F2F7] dark:bg-[#2C2C2E] relative overflow-hidden flex-shrink-0">
                      {prompt.cover ? (
                        <img src={prompt.cover} alt="cover" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                          <ImageIcon className="w-10 h-10 mb-3 opacity-30" />
                          <span className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-30">无封面图</span>
                        </div>
                      )}
                      
                      <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="flex items-center bg-black/60 backdrop-blur-xl rounded-xl p-1 border border-white/10 shadow-lg">
                          <button onClick={() => handleDuplicate(prompt)} className="p-1.5 text-white hover:bg-white/20 rounded-lg transition-colors" title="创建副本">
                            <Plus className="w-4 h-4" />
                          </button>
                          <button onClick={() => { setEditingPrompt(prompt); setIsModalOpen(true); }} className="p-1.5 text-white hover:bg-white/20 rounded-lg transition-colors" title="编辑">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(prompt.id)} className="p-1.5 text-[#FF453A] hover:bg-red-500/20 rounded-lg transition-colors" title="删除">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">
                          {new Date(prompt.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      
                      <h3 className="font-bold text-lg mb-4 tracking-tight" title={prompt.title}>{prompt.title}</h3>
                      
                      {/* 重构：全量代码块展示，支持一键点击复制 */}
                      <div 
                        onClick={() => handleCopy(prompt.prompt)}
                        className={`relative group/code flex-1 mb-5 border rounded-xl p-4 cursor-pointer transition-all duration-200 shadow-inner ${codeBg}`}
                        title="点击一键复制"
                      >
                        <div className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity bg-white dark:bg-[#2C2C2E] shadow-sm border border-black/5 dark:border-white/10 text-gray-500 rounded-md py-1 px-2 z-10 flex items-center gap-1.5">
                          <Copy className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold">复制提示词</span>
                        </div>
                        {/* 增加代码块格式和严格的换行防溢出控制 */}
                        <div className="text-xs line-clamp-6 whitespace-pre-wrap break-words font-mono font-medium leading-[1.6]">
                           {prompt.prompt.replace(/```(text|markdown)?\n?/g, '').replace(/```$/g, '')}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-auto">
                        {prompt.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
                            {tag}
                          </span>
                        ))}
                        {prompt.tags.length > 3 && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold bg-black/5 text-gray-500 dark:bg-white/10">
                            +{prompt.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </main>
      </div>

      {toast && (
        <div className="fixed bottom-10 right-10 z-[70] flex items-center gap-3 px-6 py-4 bg-[#1D1D1F] dark:bg-white text-white dark:text-black rounded-xl shadow-2xl animate-bounce">
          {toast.type === 'success' ? <Check className="w-5 h-5 text-green-400 dark:text-green-600" /> : <AlertCircle className="w-5 h-5 text-red-400 dark:text-red-600" />}
          <span className="text-sm font-bold tracking-wide">{toast.message}</span>
        </div>
      )}

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-md p-6">
          <div className={`w-full max-w-sm rounded-2xl p-8 flex flex-col items-center text-center shadow-2xl ${darkMode ? 'bg-[#1C1C1E] text-white' : 'bg-white text-black'}`}>
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mb-4">
              <Trash2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold mb-2">确认删除？</h3>
            <p className="text-sm text-gray-500 mb-8">此操作不可恢复，确定要删除这条数据吗？</p>
            <div className="flex w-full gap-4">
              <button 
                onClick={() => setConfirmDialog({ isOpen: false, id: null })} 
                className="flex-1 py-3 rounded-xl font-bold bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={executeDelete} 
                className="flex-1 py-3 rounded-xl font-bold bg-[#FF453A] hover:bg-[#FF3B30] text-white shadow-lg shadow-red-500/30 transition-all"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <PromptModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSavePrompt}
          initialData={editingPrompt}
          darkMode={darkMode}
          showToast={showToast}
        />
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  );
}

// --- Image Cropper 组件 ---
function CropperView({ src, onSave, onCancel, darkMode }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };
  
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  
  const handleMouseUp = () => setIsDragging(false);

  const handleConfirmCrop = () => {
    const canvas = document.createElement('canvas');
    const TARGET_W = 1200;
    const TARGET_H = 750;
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
      const containerRatio = TARGET_W / TARGET_H;
      const imgRatio = img.width / img.height;
      let drawWidth, drawHeight;
      
      if (imgRatio > containerRatio) {
        drawHeight = TARGET_H;
        drawWidth = TARGET_H * imgRatio;
      } else {
        drawWidth = TARGET_W;
        drawHeight = TARGET_W / imgRatio;
      }

      drawWidth *= zoom;
      drawHeight *= zoom;

      const uiRatio = TARGET_W / containerRef.current.offsetWidth;
      const finalOffsetX = offset.x * uiRatio;
      const finalOffsetY = offset.y * uiRatio;

      ctx.fillStyle = darkMode ? '#1C1C1E' : '#FFFFFF';
      ctx.fillRect(0, 0, TARGET_W, TARGET_H);

      ctx.translate(TARGET_W / 2 + finalOffsetX, TARGET_H / 2 + finalOffsetY);
      ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

      onSave(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = src;
  };

  return (
    <div className="flex flex-col h-full p-8">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-2xl font-black">调整封面位置与缩放</h3>
        <p className="text-sm font-bold text-gray-400">比例约束 16:10</p>
      </div>

      <div 
        ref={containerRef}
        className="relative w-full aspect-[16/10] bg-black/10 dark:bg-white/5 rounded-2xl overflow-hidden cursor-move border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-orange-500 transition-colors"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img 
          src={src} 
          alt="crop preview"
          className="absolute top-1/2 left-1/2 min-w-full min-h-full max-w-none pointer-events-none select-none"
          style={{ 
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
            objectFit: 'cover'
          }}
        />
        <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_40px_rgba(0,0,0,0.3)] z-10"></div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg backdrop-blur-md pointer-events-none">
          鼠标拖拽可移动图片
        </div>
      </div>

      <div className="mt-8 flex items-center gap-6 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
        <span className="text-sm font-bold text-gray-500"><ImageIcon className="w-5 h-5"/></span>
        <input 
          type="range" min="0.5" max="3" step="0.05" 
          value={zoom} 
          onChange={e=>setZoom(Number(e.target.value))} 
          className="flex-1 accent-[#FF6B00]" 
        />
        <span className="text-sm font-bold text-gray-500"><Maximize className="w-5 h-5"/></span>
      </div>

      <div className="mt-auto pt-6 flex justify-end gap-4">
        <button onClick={onCancel} className="px-8 py-3 rounded-xl font-bold bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors">
          放弃
        </button>
        <button onClick={handleConfirmCrop} className="px-8 py-3 rounded-xl font-bold bg-[#FF6B00] hover:bg-[#E66000] text-white shadow-lg shadow-orange-500/30 transition-all">
          完成裁切
        </button>
      </div>
    </div>
  );
}

// --- 独立的 Modal 组件 ---
function PromptModal({ isOpen, onClose, onSave, initialData, darkMode, showToast }) {
  const [formData, setFormData] = useState({
    title: '',
    prompt: '',
    cover: '',
    tags: []
  });
  const [tagInput, setTagInput] = useState('');
  
  const [pendingCropSrc, setPendingCropSrc] = useState(null);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData({
        title: '',
        prompt: MD_FENCE + "text\n[English Prompt]\n\n\n[Chinese Prompt]\n\n" + MD_FENCE,
        cover: '',
        tags: []
      });
    }
  }, [initialData]);

  useEffect(() => {
    const handlePaste = (e) => {
      if (pendingCropSrc) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            triggerCropper(file);
          }
          break; 
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [pendingCropSrc]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAddTag = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim().replace(/^#/, '');
      if (!formData.tags.includes(newTag)) {
        setFormData(prev => ({ ...prev, tags: [...prev.tags, newTag] }));
      }
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tagToRemove)
    }));
  };

  const triggerCropper = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => setPendingCropSrc(event.target.result);
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      triggerCropper(file);
      e.target.value = ''; 
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.prompt.trim()) {
      showToast('标题和内容为必填项', 'error');
      return;
    }
    onSave(formData);
  };

  const bgModal = darkMode ? 'bg-[#1C1C1E] text-white shadow-2xl shadow-black/50' : 'bg-white text-black shadow-2xl shadow-black/20';
  const inputBg = darkMode ? 'bg-[#2C2C2E] text-white focus:ring-white/30' : 'bg-[#F2F2F7] text-black focus:ring-black/20';

  if (pendingCropSrc) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-xl p-6">
        <div className={`w-full max-w-2xl h-[640px] rounded-2xl flex flex-col overflow-hidden shadow-2xl ${bgModal}`}>
          <CropperView 
            src={pendingCropSrc} 
            darkMode={darkMode}
            onSave={(b64) => { setFormData({...formData, cover: b64}); setPendingCropSrc(null); }} 
            onCancel={() => setPendingCropSrc(null)} 
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-6">
      <div className={`w-full max-w-4xl rounded-2xl flex flex-col max-h-[90vh] overflow-hidden ${bgModal}`}>
        
        <div className="flex items-center justify-between p-8 pb-4">
          <h2 className="text-3xl font-black tracking-tight">{initialData ? '编辑提示词' : '新建提示词'}</h2>
          <button onClick={onClose} className="p-3 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 pt-4 space-y-8 hide-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-10">
            
            <div className="md:col-span-3 space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">标题 (Title)</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  placeholder="例如：赛博朋克头像生成"
                  className={`w-full px-5 py-4 rounded-xl border-none outline-none focus:ring-4 font-bold text-lg transition-all ${inputBg}`}
                  required
                />
              </div>

              <div>
                <div className="flex justify-between items-end mb-2">
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-500">内容 (Prompt)</label>
                  <span className="text-[10px] text-gray-400 font-bold uppercase">支持 Markdown 格式</span>
                </div>
                <textarea
                  name="prompt"
                  value={formData.prompt}
                  onChange={handleChange}
                  rows={12}
                  className={`w-full px-5 py-4 rounded-xl border-none outline-none focus:ring-4 font-mono text-sm leading-relaxed transition-all resize-none ${inputBg}`}
                  required
                />
              </div>
            </div>

            <div className="md:col-span-2 space-y-8">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">封面图 (Cover Asset)</label>
                <div className={`mt-1 flex justify-center aspect-[16/10] rounded-2xl overflow-hidden relative group cursor-pointer border-4 border-transparent hover:border-black/5 dark:hover:border-white/10 transition-all ${darkMode ? 'bg-[#2C2C2E]' : 'bg-[#F2F2F7]'}`}>
                  {formData.cover ? (
                    <div className="absolute inset-0 z-10 w-full h-full">
                      <img src={formData.cover} alt="Cover" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <label className="cursor-pointer text-white text-sm font-bold py-2 px-6 bg-black/60 backdrop-blur-md rounded-xl hover:bg-black transition-colors">
                          更换图片或直接粘贴
                          <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-center p-6">
                      <div className="w-16 h-16 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-center mb-4">
                        <ImageIcon className="h-8 w-8 text-gray-400" />
                      </div>
                      <label className="cursor-pointer font-bold text-sm text-[#FF6B00] hover:text-[#E66000] mb-1">
                        <span>点击上传或直接粘贴 (Ctrl+V)</span>
                        <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                      </label>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-2">自动高清压缩，支持全局粘贴截图</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">标签 (Tags)</label>
                <div className={`flex items-center rounded-xl px-4 py-1 mb-4 ${inputBg} focus-within:ring-4 transition-all`}>
                  <Hash className="w-4 h-4 text-gray-400 mr-2" />
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    placeholder="输入标签后按回车"
                    className="w-full bg-transparent border-none outline-none py-2 text-sm font-bold placeholder-gray-400"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-black text-white dark:bg-white dark:text-black">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500 transition-colors opacity-70 hover:opacity-100 focus:outline-none">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 pt-4 flex justify-end gap-4 mt-auto">
          <button
            type="button"
            onClick={onClose}
            className="px-8 py-3 rounded-xl text-sm font-bold bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-8 py-3 rounded-xl text-sm font-bold bg-[#FF6B00] hover:bg-[#E66000] text-white shadow-lg shadow-orange-500/30 transition-all flex items-center gap-2"
          >
            确认保存
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
