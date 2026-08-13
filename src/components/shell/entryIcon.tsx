import ApartmentRoundedIcon from "@mui/icons-material/ApartmentRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import BusinessCenterRoundedIcon from "@mui/icons-material/BusinessCenterRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import TravelExploreRoundedIcon from "@mui/icons-material/TravelExploreRounded";
import AppsRoundedIcon from "@mui/icons-material/AppsRounded";
import type { SvgIconComponent } from "@mui/icons-material";

/**
 * Entry slug -> sidebar icon.
 *
 * These are DEFAULTS, not a fixed set. The slugs below are common enough shapes
 * for an internal catalog (a dashboard, a docs site, a CRM, an outbound tool)
 * that some will match out of the box; the rest are here as a worked example of
 * the pattern. Add your own as you add entries.
 *
 * Keyed by slug, not by position: `sort_order` gets renumbered whenever entries
 * are reordered, and an icon set that shifts when rows move is worse than none.
 *
 * An unmapped slug falls back rather than throwing, so adding a catalog entry
 * never breaks the shell — it simply gets the generic app glyph until someone
 * adds a line here. That means this file is always optional: delete every entry
 * below and the app still works, with one icon for everything.
 */
const BY_SLUG: Record<string, SvgIconComponent> = {
  analytics: BarChartRoundedIcon,
  dashboard: BarChartRoundedIcon,
  "marketing-dashboard": BarChartRoundedIcon,
  crm: BusinessCenterRoundedIcon,
  "client-tracker": BusinessCenterRoundedIcon,
  docs: MenuBookRoundedIcon,
  handbook: MenuBookRoundedIcon,
  "knowledge-base": MenuBookRoundedIcon,
  intranet: ApartmentRoundedIcon,
  outbound: SendRoundedIcon,
  "sales-engine": SendRoundedIcon,
  campaigns: CampaignRoundedIcon,
  podcast: MicRoundedIcon,
  reports: DescriptionRoundedIcon,
  research: TravelExploreRoundedIcon,
  "status-board": SpeedRoundedIcon,
  support: SupportAgentRoundedIcon,
  "ai-tools": AutoAwesomeRoundedIcon,
};

export function entryIcon(slug: string): SvgIconComponent {
  return BY_SLUG[slug] ?? AppsRoundedIcon;
}
