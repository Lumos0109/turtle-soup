(() => {
	const EXPORT_WATERMARK = '来源:https://soup.ahelumos.com';

	const getEl = (selector) => document.querySelector(selector);

	const parseExportData = () => {
		const dataEl = document.getElementById('soupExportData');
		if (!dataEl) return null;

		try {
			return JSON.parse(dataEl.textContent || '{}');
		} catch (error) {
			console.error('解析导出数据失败:', error);
			return null;
		}
	};

	const sanitizeFilename = (name) => {
		const cleanName = String(name || '海龟汤')
			.replace(/[\\/:*?"<>|]/g, '_')
			.replace(/\s+/g, ' ')
			.trim();

		return cleanName || '海龟汤';
	};

	const wrapText = (ctx, text, maxWidth) => {
		const source = String(text || '');
		const lines = [];

		source.split(/\r?\n/).forEach((paragraph) => {
			if (!paragraph.trim()) {
				lines.push('');
				return;
			}

			let currentLine = '';

			for (const char of paragraph) {
				const testLine = currentLine + char;
				if (ctx.measureText(testLine).width > maxWidth && currentLine) {
					lines.push(currentLine);
					currentLine = char;
				} else {
					currentLine = testLine;
				}
			}

			if (currentLine) {
				lines.push(currentLine);
			}
		});

		return lines;
	};

	const drawWrappedText = (ctx, text, x, y, maxWidth, lineHeight) => {
		const lines = wrapText(ctx, text, maxWidth);

		lines.forEach((line, index) => {
			ctx.fillText(line, x, y + index * lineHeight);
		});

		return lines.length * lineHeight;
	};

	const measureWrappedTextHeight = (ctx, text, maxWidth, lineHeight) => {
		return wrapText(ctx, text, maxWidth).length * lineHeight;
	};

	const drawSection = (ctx, options) => {
		const {
			title,
			body,
			x,
			y,
			width,
			titleFont,
			bodyFont,
			titleSize,
			bodySize,
			lineHeight,
			padding,
		} = options;

		let currentY = y;

		ctx.font = titleFont;
		ctx.fillStyle = '#111111';
		ctx.fillText(title, x, currentY);

		currentY += titleSize + 14;

		ctx.font = bodyFont;
		ctx.fillStyle = '#222222';

		const bodyHeight = drawWrappedText(ctx, body || '暂无内容', x + padding, currentY, width - padding * 2, lineHeight);

		currentY += bodyHeight + 34;

		ctx.strokeStyle = '#111111';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, currentY - 18);
		ctx.lineTo(x + width, currentY - 18);
		ctx.stroke();

		return currentY;
	};

	const createExportImage = (data) => {
		const scale = Math.max(2, window.devicePixelRatio || 1);

		const canvasWidth = 900;
		const paddingX = 64;
		const paddingTop = 72;
		const paddingBottom = 82;
		const contentWidth = canvasWidth - paddingX * 2;

		const titleSize = 38;
		const metaSize = 18;
		const sectionTitleSize = 26;
		const bodySize = 22;
		const lineHeight = 36;
		const watermarkSize = 17;

		const fontFamily = '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", Arial, sans-serif';
		const titleFont = `700 ${titleSize}px ${fontFamily}`;
		const metaFont = `400 ${metaSize}px ${fontFamily}`;
		const sectionTitleFont = `700 ${sectionTitleSize}px ${fontFamily}`;
		const bodyFont = `400 ${bodySize}px ${fontFamily}`;
		const watermarkFont = `400 ${watermarkSize}px ${fontFamily}`;

		const measureCanvas = document.createElement('canvas');
		const measureCtx = measureCanvas.getContext('2d');

		measureCtx.font = titleFont;
		const titleLines = wrapText(measureCtx, data.title || '海龟汤', contentWidth);

		let estimatedHeight = paddingTop;
		estimatedHeight += titleLines.length * 48;
		estimatedHeight += 48;

		measureCtx.font = bodyFont;
		estimatedHeight += sectionTitleSize + 14;
		estimatedHeight += measureWrappedTextHeight(measureCtx, data.surface || '暂无汤面', contentWidth - 32, lineHeight);
		estimatedHeight += 50;

		estimatedHeight += sectionTitleSize + 14;
		estimatedHeight += measureWrappedTextHeight(measureCtx, data.bottom || '暂无汤底', contentWidth - 32, lineHeight);
		estimatedHeight += 50;

		if (data.hasHostManual && data.hostManual) {
			estimatedHeight += sectionTitleSize + 14;
			estimatedHeight += measureWrappedTextHeight(measureCtx, data.hostManual, contentWidth - 32, lineHeight);
			estimatedHeight += 50;
		}

		estimatedHeight += paddingBottom;

		const canvasHeight = Math.max(720, estimatedHeight);
		const canvas = document.createElement('canvas');
		canvas.width = canvasWidth * scale;
		canvas.height = canvasHeight * scale;
		canvas.style.width = `${canvasWidth}px`;
		canvas.style.height = `${canvasHeight}px`;

		const ctx = canvas.getContext('2d');
		ctx.scale(scale, scale);

		ctx.fillStyle = '#fffdf7';
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		ctx.strokeStyle = '#111111';
		ctx.lineWidth = 4;
		ctx.strokeRect(22, 22, canvasWidth - 44, canvasHeight - 44);

		ctx.strokeStyle = '#111111';
		ctx.lineWidth = 2;
		ctx.strokeRect(34, 34, canvasWidth - 68, canvasHeight - 68);

		let y = paddingTop;

		ctx.fillStyle = '#111111';
		ctx.font = titleFont;
		titleLines.forEach((line) => {
			ctx.fillText(line, paddingX, y);
			y += 48;
		});

		y += 8;

		ctx.font = metaFont;
		ctx.fillStyle = '#555555';
		ctx.fillText('海龟汤导出图片', paddingX, y);

		y += 36;

		ctx.strokeStyle = '#111111';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(paddingX, y);
		ctx.lineTo(canvasWidth - paddingX, y);
		ctx.stroke();

		y += 48;

		y = drawSection(ctx, {
			title: '汤面',
			body: data.surface || '暂无汤面',
			x: paddingX,
			y,
			width: contentWidth,
			titleFont: sectionTitleFont,
			bodyFont,
			titleSize: sectionTitleSize,
			bodySize,
			lineHeight,
			padding: 16,
		});

		y += 16;

		y = drawSection(ctx, {
			title: '汤底',
			body: data.bottom || '暂无汤底',
			x: paddingX,
			y,
			width: contentWidth,
			titleFont: sectionTitleFont,
			bodyFont,
			titleSize: sectionTitleSize,
			bodySize,
			lineHeight,
			padding: 16,
		});

		if (data.hasHostManual && data.hostManual) {
			y += 16;

			y = drawSection(ctx, {
				title: '主持人手册',
				body: data.hostManual,
				x: paddingX,
				y,
				width: contentWidth,
				titleFont: sectionTitleFont,
				bodyFont,
				titleSize: sectionTitleSize,
				bodySize,
				lineHeight,
				padding: 16,
			});
		}

		ctx.font = watermarkFont;
		ctx.fillStyle = '#666666';
		ctx.textAlign = 'right';
		ctx.fillText(EXPORT_WATERMARK, canvasWidth - paddingX, canvasHeight - 52);
		ctx.textAlign = 'left';

		return canvas.toDataURL('image/png');
	};

	const openModal = (modal) => {
		if (!modal) return;
		modal.classList.remove('hidden');
		modal.classList.add('flex');
		document.body.classList.add('overflow-hidden');
	};

	const closeModal = (modal) => {
		if (!modal) return;
		modal.classList.add('hidden');
		modal.classList.remove('flex');
		document.body.classList.remove('overflow-hidden');
	};

	const initSoupExport = () => {
		const exportBtn = getEl('.js-soup-export-btn');
		const modal = document.getElementById('soupExportModal');
		const previewImg = document.getElementById('soupExportPreviewImg');
		const saveLink = document.getElementById('soupExportSaveLink');
		const closeBtns = document.querySelectorAll('.js-soup-export-close');

		if (!exportBtn || !modal || !previewImg || !saveLink) return;

		exportBtn.addEventListener('click', () => {
			const data = parseExportData();

			if (!data) {
				alert('导出失败：没有找到海龟汤数据');
				return;
			}

			const imageUrl = createExportImage(data);

			previewImg.src = imageUrl;
			saveLink.href = imageUrl;
			saveLink.download = `${sanitizeFilename(data.title)}.png`;

			openModal(modal);
		});

		closeBtns.forEach((btn) => {
			btn.addEventListener('click', () => closeModal(modal));
		});

		modal.addEventListener('click', (event) => {
			if (event.target === modal) {
				closeModal(modal);
			}
		});

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
				closeModal(modal);
			}
		});
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initSoupExport);
	} else {
		initSoupExport();
	}
})();