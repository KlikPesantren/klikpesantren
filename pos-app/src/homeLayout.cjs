// Actual module height is measured after safe area, app header and bottom tabs.
function homeLayout({ height, width, fontScale = 1, contentHeight = 0 }) {
  const compact = height >= 500 && width >= 340 && fontScale <= 1.15;
  return { compact, scroll: !compact || contentHeight > height + 1, gap: compact ? 5 : 10 };
}
module.exports = { homeLayout };
