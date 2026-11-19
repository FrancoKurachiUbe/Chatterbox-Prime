import React from 'react';
import {
  LayoutDashboard,
  FileText,
  Mic,
  Sliders,
  PlaySquare,
  Headphones,
  FolderKanban,
  Radio,
} from 'lucide-react';
import { ProjectSummaryMetrics, StudioSectionTab, SystemStatusResponse } from '../types';

interface SidebarNavProps {
  activeTab: StudioSectionTab;
  onSelectTab: (tab: StudioSectionTab) => void;
  systemStatus: SystemStatusResponse;
  activeProjectName: string;
  summary: ProjectSummaryMetrics;
}

const NAV_ITEMS: Array<{ id: StudioSectionTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: '1. Panel Principal', icon: LayoutDashboard },
  { id: 'editor', label: '2. Editor de Guiones', icon: FileText },
  { id: 'voices', label: '3. Biblioteca de Voces', icon: Mic },
  { id: 'settings', label: '4. Configuración Qwen3', icon: Sliders },
  { id: 'production', label: '5. Producción de Audio', icon: PlaySquare },
  { id: 'player', label: '6. Reproductor', icon: Headphones },
  { id: 'projects', label: '7. Gestión de Proyectos', icon: FolderKanban },
];

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  onSelectTab,
  systemStatus,
  activeProjectName,
  summary,
}) => {
  const isOnline = systemStatus.status === 'online';
  const hw = systemStatus.hardware;

  return (
    <aside className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-[#1b2333] bg-[#0b0f17] flex flex-col">
      {/* Brand */}
      <div className="p-5 border-b border-[#1b2333] flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 shrink-0">
          <Radio className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-extrabold tracking-wide text-white truncate">
            Qwen3Prime
          </h1>
          <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 truncate">
            Studio de Narración IA
          </div>
        </div>
      </div>

      {/* Active Project Snapshot */}
      <div className="px-4 py-3 border-b border-[#1b2333] bg-[#0e131d]">
        <div className="text-[10px] uppercase tracking-wider font-bold text-[#64748b]">
          Proyecto Activo
        </div>
        <div className="text-xs font-bold text-white truncate mt-0.5" title={activeProjectName}>
          {activeProjectName || 'Sin proyecto'}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-[#94a3b8]">
          <span>
            {summary.ready_parts}/{summary.total_parts} partes
          </span>
          <span className="text-cyan-400 font-bold">{summary.percent}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-[#1b2333] overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${summary.percent}%` }}
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible flex-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap transition-all cursor-pointer text-left ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/35 shadow-sm'
                  : 'text-[#94a3b8] hover:text-white hover:bg-[#121826] border border-transparent'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-[#64748b]'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Hardware Footer */}
      <div className="p-4 border-t border-[#1b2333] bg-[#090d14] text-[11px] space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[#64748b] font-semibold">Servidor Local</span>
          <span
            className={`font-bold ${isOnline ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            {isOnline ? '● En línea' : '● Desconectado'}
          </span>
        </div>
        <div className="flex items-center justify-between text-[#94a3b8]">
          <span>Motor</span>
          <span className="font-mono text-cyan-300">
            {hw.cuda_available ? 'CUDA' : 'CPU'}
          </span>
        </div>
        <div className="flex items-center justify-between text-[#94a3b8]">
          <span>Modelo</span>
          <span className="font-mono text-white">
            {systemStatus.model.loaded ? 'Cargado' : 'En reposo'}
          </span>
        </div>
      </div>
    </aside>
  );
};
