class EnhancedPDFQRScanner {
    constructor() {
        this.qrResults = [];
        this.currentFile = null;
        this.debugMode = false;
        this.settings = {
            scale: 3.0,
            contrast: 1.0,
            brightness: 1.0,
            multiScale: true
        };
        
        this.initializeEventListeners();
        
        // PDF.js worker'ı ayarla
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    initializeEventListeners() {
        // Dosya yükleme
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', this.handleFileSelect.bind(this));
        dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
        dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
        dropZone.addEventListener('drop', this.handleFileDrop.bind(this));
        
        // Ayar kontrolleri
        document.getElementById('scaleRange').addEventListener('input', (e) => {
            this.settings.scale = parseFloat(e.target.value);
            document.getElementById('scaleValue').textContent = e.target.value;
        });
        
        document.getElementById('contrastRange').addEventListener('input', (e) => {
            this.settings.contrast = parseFloat(e.target.value);
            document.getElementById('contrastValue').textContent = e.target.value;
        });
        
        document.getElementById('brightnessRange').addEventListener('input', (e) => {
            this.settings.brightness = parseFloat(e.target.value);
            document.getElementById('brightnessValue').textContent = e.target.value;
        });
        
        document.getElementById('debugMode').addEventListener('change', (e) => {
            this.debugMode = e.target.checked;
            document.getElementById('debugCanvases').style.display = e.target.checked ? 'block' : 'none';
        });
        
        document.getElementById('multiScale').addEventListener('change', (e) => {
            this.settings.multiScale = e.target.checked;
        });
        
        // Dışa aktarma
        document.getElementById('exportJSON').addEventListener('click', () => this.exportResults('json'));
        document.getElementById('exportCSV').addEventListener('click', () => this.exportResults('csv'));
        document.getElementById('exportHTML').addEventListener('click', () => this.exportResults('html'));
    }

    handleDragOver(e) {
        e.preventDefault();
        document.getElementById('dropZone').classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        document.getElementById('dropZone').classList.remove('dragover');
    }

    handleFileDrop(e) {
        e.preventDefault();
        document.getElementById('dropZone').classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            this.processFile(files[0]);
        } else {
            this.showAlert('Lütfen geçerli bir PDF dosyası seçin!', 'danger');
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
            this.processFile(file);
        } else {
            this.showAlert('Lütfen geçerli bir PDF dosyası seçin!', 'danger');
        }
    }

    async processFile(file) {
        this.currentFile = file;
        this.qrResults = [];
        
        this.showProgress(true);
        
        if (this.debugMode) {
            document.getElementById('canvasContainer').innerHTML = '';
        }
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            const totalPages = pdf.numPages;
            
            document.getElementById('totalPages').textContent = totalPages;
            
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                document.getElementById('currentPageInfo').textContent = `Sayfa ${pageNum}/${totalPages} işleniyor...`;
                
                await this.processPage(pdf, pageNum);
                
                const progress = (pageNum / totalPages) * 100;
                this.updateProgress(progress);
                
                // UI'nin yanıt vermesi için kısa bir bekleme
                await this.sleep(50);
            }
            
            await this.validateAllQRCodes();
            this.displayResults();
            this.updateStatistics();
            this.showExportButtons(true);
            
        } catch (error) {
            console.error('PDF işleme hatası:', error);
            this.showAlert('PDF dosyası işlenirken hata oluştu: ' + error.message, 'danger');
        } finally {
            this.showProgress(false);
        }
    }

    async processPage(pdf, pageNum) {
        try {
            const page = await pdf.getPage(pageNum);
            
            if (this.settings.multiScale) {
                // Çoklu ölçekte tarama
                const scales = [2.0, 3.0, 4.0, 5.0];
                for (const scale of scales) {
                    const found = await this.scanPageAtScale(page, pageNum, scale);
                    if (found > 0) {
                        console.log(`Sayfa ${pageNum}: ${found} QR kod bulundu (Ölçek: ${scale})`);
                        break; // QR kod bulundu, diğer ölçekleri dene
                    }
                }
            } else {
                // Tek ölçekte tarama
                await this.scanPageAtScale(page, pageNum, this.settings.scale);
            }
            
        } catch (error) {
            console.error(`Sayfa ${pageNum} işleme hatası:`, error);
        }
    }

    async scanPageAtScale(page, pageNum, scale) {
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // PDF sayfasını canvas'a render et
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        // Görüntü iyileştirmesi uygula
        this.enhanceImage(context, canvas.width, canvas.height);
        
        // Debug modda canvas'ı göster
        if (this.debugMode) {
            this.addDebugCanvas(canvas, pageNum, scale);
        }
        
        // QR kodları tara
        return this.scanQRCodesFromCanvas(canvas, pageNum, scale);
    }

    enhanceImage(context, width, height) {
        // Görüntü verilerini al
        const imageData = context.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        // Kontrast ve parlaklık ayarla
        const contrast = this.settings.contrast;
        const brightness = this.settings.brightness;
        
        for (let i = 0; i < data.length; i += 4) {
            // RGB kanalları için kontrast ve parlaklık uygula
            data[i] = Math.min(255, Math.max(0, (data[i] - 128) * contrast + 128 + brightness * 50)); // R
            data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * contrast + 128 + brightness * 50)); // G
            data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * contrast + 128 + brightness * 50)); // B
        }
        
        // İyileştirilmiş görüntüyü geri yaz
        context.putImageData(imageData, 0, 0);
    }

    addDebugCanvas(canvas, pageNum, scale) {
        const debugCanvas = canvas.cloneNode();
        const debugContext = debugCanvas.getContext('2d');
        debugContext.drawImage(canvas, 0, 0);
        
        debugCanvas.className = 'debug-canvas';
        debugCanvas.title = `Sayfa ${pageNum} - Ölçek: ${scale}`;
        
        const container = document.getElementById('canvasContainer');
        const wrapper = document.createElement('div');
        wrapper.className = 'text-center m-2';
        wrapper.innerHTML = `
            <canvas class="debug-canvas"></canvas>
            <div><small>Sayfa ${pageNum}<br>Ölçek: ${scale}</small></div>
        `;
        wrapper.querySelector('canvas').replaceWith(debugCanvas);
        container.appendChild(wrapper);
    }

    scanQRCodesFromCanvas(canvas, pageNum, scale) {
        const context = canvas.getContext('2d');
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        let foundCount = 0;
        
        try {
            // Ana QR kod taraması
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert" // Performans için tersine çevirme deneme
            });
            
            if (code) {
                // Aynı QR kodun tekrar eklenmesini önle
                const exists = this.qrResults.find(result => 
                    result.page === pageNum && result.data === code.data
                );
                
                if (!exists) {
                    const qrResult = {
                        id: this.generateUniqueId(),
                        page: pageNum,
                        data: code.data,
                        location: code.location,
                        scale: scale,
                        timestamp: new Date().toISOString(),
                        status: 'pending',
                        responseTime: null,
                        errorMessage: null,
                        preview: this.generateQRPreview(canvas, code.location)
                    };
                    
                    this.qrResults.push(qrResult);
                    foundCount++;
                    
                    console.log(`QR kod bulundu - Sayfa ${pageNum}, Ölçek ${scale}:`, code.data.substring(0, 50) + '...');
                }
            }
            
            // Ek tarama algoritması - farklı bölgeleri tara
            if (foundCount === 0) {
                foundCount += this.scanImageRegions(imageData, canvas, pageNum, scale);
            }
            
        } catch (error) {
            console.error(`Sayfa ${pageNum} QR tarama hatası:`, error);
        }
        
        return foundCount;
    }

    scanImageRegions(imageData, canvas, pageNum, scale) {
        let foundCount = 0;
        const regions = [
            { x: 0, y: 0, w: canvas.width / 2, h: canvas.height / 2 }, // Sol üst
            { x: canvas.width / 2, y: 0, w: canvas.width / 2, h: canvas.height / 2 }, // Sağ üst
            { x: 0, y: canvas.height / 2, w: canvas.width / 2, h: canvas.height / 2 }, // Sol alt
            { x: canvas.width / 2, y: canvas.height / 2, w: canvas.width / 2, h: canvas.height / 2 } // Sağ alt
        ];
        
        regions.forEach((region, index) => {
            try {
                const regionCanvas = document.createElement('canvas');
                const regionContext = regionCanvas.getContext('2d');
                regionCanvas.width = region.w;
                regionCanvas.height = region.h;
                
                regionContext.drawImage(canvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
                
                const regionImageData = regionContext.getImageData(0, 0, region.w, region.h);
                const code = jsQR(regionImageData.data, regionImageData.width, regionImageData.height);
                
                if (code) {
                    const exists = this.qrResults.find(result => 
                        result.page === pageNum && result.data === code.data
                    );
                    
                    if (!exists) {
                        const qrResult = {
                            id: this.generateUniqueId(),
                            page: pageNum,
                            data: code.data,
                            location: code.location,
                            scale: scale,
                            region: `Bölge ${index + 1}`,
                            timestamp: new Date().toISOString(),
                            status: 'pending',
                            responseTime: null,
                            errorMessage: null,
                            preview: this.generateQRPreview(regionCanvas, code.location)
                        };
                        
                        this.qrResults.push(qrResult);
                        foundCount++;
                        
                        console.log(`Bölgesel QR kod bulundu - Sayfa ${pageNum}, Bölge ${index + 1}:`, code.data.substring(0, 50) + '...');
                    }
                }
            } catch (error) {
                console.error(`Bölge ${index + 1} tarama hatası:`, error);
            }
        });
        
        return foundCount;
    }

    generateUniqueId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    generateQRPreview(canvas, location) {
        try {
            const context = canvas.getContext('2d');
            const padding = 20;
            const minX = Math.max(0, Math.min(...location.map(p => p.x)) - padding);
            const minY = Math.max(0, Math.min(...location.map(p => p.y)) - padding);
            const maxX = Math.min(canvas.width, Math.max(...location.map(p => p.x)) + padding);
            const maxY = Math.min(canvas.height, Math.max(...location.map(p => p.y)) + padding);
            
            const width = maxX - minX;
            const height = maxY - minY;
            
            const previewCanvas = document.createElement('canvas');
            const previewContext = previewCanvas.getContext('2d');
            previewCanvas.width = Math.max(100, width);
            previewCanvas.height = Math.max(100, height);
            
            previewContext.drawImage(canvas, minX, minY, width, height, 0, 0, previewCanvas.width, previewCanvas.height);
            
            return previewCanvas.toDataURL('image/png');
        } catch (error) {
            console.error('Önizleme oluşturma hatası:', error);
            return '';
        }
    }

    async validateAllQRCodes() {
        console.log(`${this.qrResults.length} QR kod doğrulanacak...`);
        
        for (let i = 0; i < this.qrResults.length; i++) {
            const result = this.qrResults[i];
            await this.validateQRCode(result);
            
            // İlerleme göstergesi
            const progress = ((i + 1) / this.qrResults.length) * 100;
            document.getElementById('currentPageInfo').textContent = `QR kodlar doğrulanıyor... ${i + 1}/${this.qrResults.length}`;
        }
    }

    async validateQRCode(qrResult) {
        const startTime = performance.now();
        
        try {
            if (this.isURL(qrResult.data)) {
                const response = await this.checkURL(qrResult.data);
                qrResult.status = response.status;
                qrResult.responseTime = performance.now() - startTime;
                qrResult.errorMessage = response.error;
                qrResult.httpStatus = response.httpStatus;
            } else {
                // URL olmayan QR kodları için temel doğrulama
                qrResult.status = 'valid-data';
                qrResult.responseTime = performance.now() - startTime;
            }
        } catch (error) {
            qrResult.status = 'error';
            qrResult.errorMessage = error.message;
            qrResult.responseTime = performance.now() - startTime;
        }
    }

    isURL(string) {
        try {
            new URL(string);
            return true;
        } catch {
            // Yaygın URL formatlarını kontrol et
            return /^https?:\/\//.test(string) || /^www\./.test(string);
        }
    }

    async checkURL(url) {
        try {
            // URL'yi düzelt
            if (!url.startsWith('http')) {
                url = 'https://' + url.replace(/^www\./, '');
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, {
                signal: controller.signal,
                method: 'GET'
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.status && data.status.http_code) {
                    const httpCode = data.status.http_code;
                    if (httpCode >= 200 && httpCode < 400) {
                        return { status: 'working', httpStatus: httpCode };
                    } else {
                        return { 
                            status: 'broken', 
                            error: `HTTP ${httpCode}`,
                            httpStatus: httpCode 
                        };
                    }
                } else {
                    return { status: 'working' };
                }
            } else {
                return { 
                    status: 'broken', 
                    error: `Proxy hatası: ${response.status}`,
                    httpStatus: response.status 
                };
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                return { 
                    status: 'broken', 
                    error: 'Zaman aşımı (15s)' 
                };
            } else {
                return { 
                    status: 'broken', 
                    error: `Bağlantı hatası: ${error.message}` 
                };
            }
        }
    }

    displayResults() {
        const resultsContainer = document.getElementById('results');
        resultsContainer.innerHTML = '';
        
        if (this.qrResults.length === 0) {
            resultsContainer.innerHTML = `
                <div class="alert alert-warning text-center">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h5>QR Kod Bulunamadı</h5>
                    <p>PDF dosyasında QR kod tespit edilemedi. Lütfen aşağıdaki önerileri deneyin:</p>
                    <ul class="list-unstyled">
                        <li>• Ölçek faktörünü artırın (3.0-5.0)</li>
                        <li>• Kontrast ayarını değiştirin</li>
                        <li>• Debug modunu açarak görüntü kalitesini kontrol edin</li>
                        <li>• Çoklu ölçek taramayı etkinleştirin</li>
                    </ul>
                </div>
            `;
            return;
        }
        
        // Başarı mesajı
        resultsContainer.innerHTML = `
            <div class="alert alert-success text-center mb-4">
                <i class="fas fa-check-circle"></i>
                <strong>${this.qrResults.length} QR kod başarıyla tespit edildi!</strong>
            </div>
        `;
        
        this.qrResults.forEach((result, index) => {
            const resultDiv = this.createResultElement(result, index);
            resultsContainer.appendChild(resultDiv);
        });
    }

    createResultElement(result, index) {
        const div = document.createElement('div');
        div.className = `qr-result ${this.getResultClass(result.status)}`;
        
        const statusIcon = this.getStatusIcon(result.status);
        const statusText = this.getStatusText(result.status);
        
        div.innerHTML = `
            <div class="row">
                <div class="col-md-2 text-center">
                    ${result.preview ? `<img src="${result.preview}" alt="QR Preview" class="qr-preview mb-2">` : '<div class="qr-preview mb-2 d-flex align-items-center justify-content-center bg-light"><i class="fas fa-qrcode fa-2x"></i></div>'}
                    <br>
                    <small class="text-muted">
                        Sayfa ${result.page}<br>
                        ${result.scale ? `Ölçek: ${result.scale}` : ''}
                        ${result.region ? `<br>${result.region}` : ''}
                    </small>
                </div>
                <div class="col-md-8">
                    <h6>
                        <i class="${statusIcon}"></i>
                        QR Kod #${index + 1} - ${statusText}
                    </h6>
                    <p class="mb-1"><strong>İçerik:</strong> <code class="user-select-all">${this.truncateText(result.data, 80)}</code></p>
                    <p class="mb-1"><strong>Tip:</strong> ${this.getDataType(result.data)}</p>
                    <p class="mb-1"><strong>Yanıt Süresi:</strong> ${result.responseTime ? Math.round(result.responseTime) + 'ms' : 'N/A'}</p>
                    ${result.httpStatus ? `<p class="mb-1"><strong>HTTP Durum:</strong> ${result.httpStatus}</p>` : ''}
                    ${result.errorMessage ? `<p class="mb-1 text-danger"><strong>Hata:</strong> ${result.errorMessage}</p>` : ''}
                    <small class="text-muted">Tarih: ${new Date(result.timestamp).toLocaleString('tr-TR')}</small>
                </div>
                <div class="col-md-2 text-end">
                    <button class="btn btn-sm btn-outline-primary mb-1" onclick="navigator.clipboard.writeText('${result.data.replace(/'/g, "\\'")}').then(() => alert('Kopyalandı!'))">
                        <i class="fas fa-copy"></i> Kopyala
                    </button>
                    ${this.isURL(result.data) ? `
                        <button class="btn btn-sm btn-outline-success" onclick="window.open('${this.normalizeURL(result.data)}', '_blank')">
                            <i class="fas fa-external-link-alt"></i> Aç
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        return div;
    }

    normalizeURL(url) {
        if (!url.startsWith('http')) {
            return 'https://' + url.replace(/^www\./, '');
        }
        return url;
    }

    getResultClass(status) {
        switch (status) {
            case 'working':
            case 'valid-data':
                return 'qr-success';
            case 'broken':
            case 'error':
                return 'qr-error';
            default:
                return 'qr-warning';
        }
    }

    getStatusIcon(status) {
        switch (status) {
            case 'working':
            case 'valid-data':
                return 'fas fa-check-circle text-success';
            case 'broken':
            case 'error':
                return 'fas fa-times-circle text-danger';
            default:
                return 'fas fa-question-circle text-warning';
        }
    }

    getStatusText(status) {
        const statusTexts = {
            'working': 'Çalışıyor',
            'broken': 'Bozuk/Erişilemiyor',
            'valid-data': 'Geçerli Veri',
            'error': 'Hata',
            'pending': 'Kontrol Ediliyor',
            'unknown': 'Bilinmeyen'
        };
        return statusTexts[status] || 'Bilinmeyen';
    }

    getDataType(data) {
        if (this.isURL(data)) return 'URL/Web Sitesi';
        if (data.includes('@') && data.includes('.')) return 'E-posta Adresi';
        if (data.startsWith('tel:') || /^\+?[\d\s\-\(\)]+$/.test(data)) return 'Telefon Numarası';
        if (data.startsWith('sms:')) return 'SMS';
        if (data.toLowerCase().includes('wifi:')) return 'WiFi Ayarları';
        if (data.startsWith('mailto:')) return 'E-posta';
        if (data.startsWith('geo:')) return 'Konum Bilgisi';
        return 'Metin Verisi';
    }

    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    updateStatistics() {
        const workingCount = this.qrResults.filter(r => r.status === 'working' || r.status === 'valid-data').length;
        const brokenCount = this.qrResults.filter(r => r.status === 'broken' || r.status === 'error').length;
        
        document.getElementById('totalQR').textContent = this.qrResults.length;
        document.getElementById('workingQR').textContent = workingCount;
        document.getElementById('brokenQR').textContent = brokenCount;
        
        document.getElementById('summaryStats').style.display = 'block';
    }

    exportResults(format) {
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `qr-tarama-raporu-${timestamp}`;
        
        switch (format) {
            case 'json':
                this.downloadJSON(filename);
                break;
            case 'csv':
                this.downloadCSV(filename);
                break;
            case 'html':
                this.downloadHTML(filename);
                break;
        }
    }

    downloadJSON(filename) {
        const data = {
            file: this.currentFile.name,
            scanDate: new Date().toISOString(),
            settings: this.settings,
            totalQRCodes: this.qrResults.length,
            statistics: {
                working: this.qrResults.filter(r => r.status === 'working' || r.status === 'valid-data').length,
                broken: this.qrResults.filter(r => r.status === 'broken' || r.status === 'error').length
            },
            results: this.qrResults
        };
        
        this.downloadFile(JSON.stringify(data, null, 2), `${filename}.json`, 'application/json');
    }

    downloadCSV(filename) {
        const headers = ['ID', 'Sayfa', 'İçerik', 'Durum', 'Tip', 'Ölçek', 'Bölge', 'Yanıt Süresi (ms)', 'HTTP Durum', 'Hata Mesajı', 'Tarih'];
        const rows = this.qrResults.map(result => [
            result.id,
            result.page,
            `"${result.data.replace(/"/g, '""')}"`,
            this.getStatusText(result.status),
            this.getDataType(result.data),
            result.scale || '',
            result.region || '',
            result.responseTime ? Math.round(result.responseTime) : '',
            result.httpStatus || '',
            `"${(result.errorMessage || '').replace(/"/g, '""')}"`,
            new Date(result.timestamp).toLocaleString('tr-TR')
        ]);
        
        const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        this.downloadFile(csv, `${filename}.csv`, 'text/csv;charset=utf-8');
    }

    downloadHTML(filename) {
        const workingCount = this.qrResults.filter(r => r.status === 'working' || r.status === 'valid-data').length;
        const brokenCount = this.qrResults.filter(r => r.status === 'broken' || r.status === 'error').length;
        
        const html = `
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>QR Kod Tarama Raporu</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                .qr-item { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 8px; }
                .success { border-left: 5px solid #28a745; background-color: #d4edda; }
                .error { border-left: 5px solid #dc3545; background-color: #f8d7da; }
                .warning { border-left: 5px solid #ffc107; background-color: #fff3cd; }
                code { background: #f8f9fa; padding: 2px 4px; border-radius: 4px; word-break: break-all; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header text-center">
                    <h1><i class="fas fa-qrcode"></i> QR Kod Tarama Raporu</h1>
                    <p><strong>Dosya:</strong> ${this.currentFile.name}</p>
                    <p><strong>Tarama Tarihi:</strong> ${new Date().toLocaleString('tr-TR')}</p>
                </div>
                
                <div class="row text-center mb-4">
                    <div class="col-md-4">
                        <div class="card">
                            <div class="card-body">
                                <h3 class="text-primary">${this.qrResults.length}</h3>
                                <p>Toplam QR Kod</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card">
                            <div class="card-body">
                                <h3 class="text-success">${workingCount}</h3>
                                <p>Çalışan</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card">
                            <div class="card-body">
                                <h3 class="text-danger">${brokenCount}</h3>
                                <p>Bozuk</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                ${this.qrResults.map((result, index) => `
                    <div class="qr-item ${this.getResultClass(result.status)}">
                        <div class="row">
                            <div class="col-md-8">
                                <h5><i class="${this.getStatusIcon(result.status)}"></i> QR Kod #${index + 1} (Sayfa ${result.page})</h5>
                                <p><strong>Durum:</strong> ${this.getStatusText(result.status)}</p>
                                <p><strong>İçerik:</strong> <code>${result.data}</code></p>
                                <p><strong>Tip:</strong> ${this.getDataType(result.data)}</p>
                                <p><strong>Yanıt Süresi:</strong> ${result.responseTime ? Math.round(result.responseTime) + 'ms' : 'N/A'}</p>
                                ${result.httpStatus ? `<p><strong>HTTP Durum:</strong> ${result.httpStatus}</p>` : ''}
                                ${result.scale ? `<p><strong>Ölçek:</strong> ${result.scale}</p>` : ''}
                                ${result.region ? `<p><strong>Bölge:</strong> ${result.region}</p>` : ''}
                                ${result.errorMessage ? `<p><strong>Hata:</strong> ${result.errorMessage}</p>` : ''}
                            </div>
                            <div class="col-md-4 text-end">
                                ${result.preview ? `<img src="${result.preview}" alt="QR Preview" style="max-width: 120px; max-height: 120px; border: 1px solid #ddd; border-radius: 4px;">` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </body>
        </html>
        `;
        
        this.downloadFile(html, `${filename}.html`, 'text/html;charset=utf-8');
    }

    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showAlert(message, type) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
        alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(alertDiv);
        
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 5000);
    }

    showProgress(show) {
        document.getElementById('progressContainer').style.display = show ? 'block' : 'none';
    }

    updateProgress(percentage) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        
        progressBar.style.width = percentage + '%';
        progressText.textContent = Math.round(percentage) + '%';
    }

    showExportButtons(show) {
        document.getElementById('exportButtons').style.display = show ? 'block' : 'none';
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Uygulamayı başlat
document.addEventListener('DOMContentLoaded', () => {
    new EnhancedPDFQRScanner();
});
