// pdf-export.js - Version finale complète et corrigée

class PDFExporter {
    constructor(options = {}) {
        this.buttonId = options.buttonId || 'download-pdf';               // Bouton élève
        this.profButtonId = options.profButtonId || 'download-pdf-prof';   // Bouton prof
        this.backgroundImage1 = options.backgroundImage1 || 'images_cours/Dégauchisseuse 2020 P_Page_1.jpg';
        this.backgroundImage2 = options.backgroundImage2 || 'images_cours/Dégauchisseuse 2020 P_Page_2.jpg';
        this.annotationsSelector = options.annotationsSelector || '.input-wrapper, .hotspot, .hotspot-path, svg';
        this.filenamePrefix = options.filenamePrefix || 'exercice';
        this.userName = null;
    }

    init() {
        const button = document.getElementById(this.buttonId);
        const profButton = document.getElementById(this.profButtonId);

        if (button) {
            button.addEventListener('click', () => this.generatePDF({ anonymous: false }));
        }
        if (profButton) {
            profButton.addEventListener('click', () => this.generatePDF({ anonymous: true }));
        }
    }

    async getUserName() {
        if (this.userName) return this.userName;

        const selectors = ['.usermenu .usertext', '.usertext', '.login .usertext', '[data-region="usermenu"] .usertext', '.navbar .usertext'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) {
                this.userName = el.textContent.trim();
                return this.userName;
            }
        }

        const input = prompt('Entrez votre Prénom et Nom (ex: Jean Dupont) :');
        this.userName = input?.trim() || 'Élève_Inconnu';
        return this.userName;
    }

    parseName(fullName) {
        const parts = fullName.trim().split(/\s+/);
        return {
            firstname: parts[0] || 'Prénom',
            lastname: parts.slice(1).join(' ') || 'Nom'
        };
    }

    async ensureImageLoaded(imgEl) {
        if (!imgEl) throw new Error('Image de page introuvable dans le HTML.');
        if (imgEl.complete && imgEl.naturalWidth > 0) return imgEl;
        return new Promise((resolve, reject) => {
            imgEl.onload = () => {
                if (imgEl.naturalWidth > 0) resolve(imgEl);
                else reject(new Error('Image de synthèse invalide (dimensions nulles).'));
            };
            imgEl.onerror = () => reject(new Error(
                'Image de synthèse non chargée. Régénérez le HTML avec ⚡ GÉNÉRER (images visibles dans l’éditeur).'
            ));
        });
    }

    /** Utilise l’<img class="page-image"> déjà affichée (évite les chemins file:// locaux) */
    async capturePageImage(...selectors) {
        let el = null;
        for (const sel of selectors) {
            el = document.querySelector(sel);
            if (el) break;
        }
        return this.ensureImageLoaded(el);
    }

    /** Convertit une Image (ou data URL) en chaîne utilisable par jsPDF */
    imageToPdfData(img) {
        if (typeof img === 'string' && img.startsWith('data:')) {
            const m = img.match(/^data:image\/(\w+);/i);
            const format = m && m[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG';
            return { data: img, format };
        }
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error('Image invalide pour le PDF.');
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        let format = 'JPEG';
        let data = canvas.toDataURL('image/jpeg', 0.92);
        if (img.src && /^data:image\/png/i.test(img.src)) {
            format = 'PNG';
            data = canvas.toDataURL('image/png');
        }
        return { data, format };
    }

    async loadLibraries() {
        if (window.html2canvas && window.jspdf) return;

        if (!window.html2canvas) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
        }

        if (!window.jspdf) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
        }
    }

    addFullPageImage(doc, img) {
        const pdfWidth = doc.internal.pageSize.getWidth();   // 420 mm
        const pdfHeight = doc.internal.pageSize.getHeight(); // 297 mm

        const imgRatio = img.width / img.height;
        const pageRatio = pdfWidth / pdfHeight;

        let w, h, x = 0, y = 0;

        if (imgRatio > pageRatio) {
            h = pdfHeight;
            w = h * imgRatio;
            x = (pdfWidth - w) / 2;
        } else {
            w = pdfWidth;
            h = w / imgRatio;
            y = (pdfHeight - h) / 2;
        }

        const { data, format } = this.imageToPdfData(img);
        doc.addImage(data, format, x, y, w, h);
    }

    async addAnnotationsOverlay(doc) {
        const elements = document.querySelectorAll(this.annotationsSelector);
        if (elements.length === 0) return;

        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.background = 'transparent';

        elements.forEach(el => container.appendChild(el.cloneNode(true)));

        document.body.appendChild(container);

        let canvas;
        try {
            canvas = await html2canvas(container, {
                scale: 2,
                backgroundColor: null,
                useCORS: false,
                allowTaint: true,
                logging: false
            });
        } catch (err) {
            console.warn('html2canvas annotations:', err);
            document.body.removeChild(container);
            return;
        }

        document.body.removeChild(container);

        if (!canvas || canvas.width === 0 || canvas.height === 0) return;

        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = doc.internal.pageSize.getHeight();
        const imgRatio = canvas.width / canvas.height;
        const pageRatio = pdfWidth / pdfHeight;

        let w, h, x = 0, y = 0;
        if (imgRatio > pageRatio) {
            h = pdfHeight;
            w = h * imgRatio;
            x = (pdfWidth - w) / 2;
        } else {
            w = pdfWidth;
            h = w / imgRatio;
            y = (pdfHeight - h) / 2;
        }

        doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h);
    }

    addHeaderText(doc, line1, line2, scoreText) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);

        doc.setFontSize(16);
        const width1 = doc.getTextWidth(line1);
        doc.text(line1, (210 - width1 - 10), 19);

        doc.setFontSize(12);
        const width2 = doc.getTextWidth(line2);
        doc.text(line2, (210 - width2 - 10), 25);

        doc.setFontSize(12);
        const width3 = doc.getTextWidth(scoreText);
        doc.text(scoreText, (210 - width3 - 10), 30);
    }

    async generatePDF(options = {}) {
        const anonymous = options.anonymous || false;
        // forceDownload is now handled by anonymous=true implicitly avoiding score check, 
        // or we can keep it if needed, but anonymous implies no score check.

        const urlParams = new URLSearchParams(window.location.search);
        const isAdmin = urlParams.has('admin') || urlParams.has('prof');

        // CHECK SCORE ONLY IF NOT ANONYMOUS AND NOT ADMIN
        if (!isAdmin && !anonymous) {
            const scoreEl = document.getElementById('score');
            const totalEl = document.getElementById('total-score');
            const score = parseFloat(scoreEl?.textContent || 0);
            const total = parseFloat(totalEl?.textContent || 10);

            if (score < total / 2) {
                alert(`Votre score (${score}/${total}) est insuffisant. Minimum requis : ${Math.ceil(total / 2)} points.`);
                return;
            }
        }

        await this.loadLibraries();

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a3'
        });

        let line1 = '';
        let line2 = '';
        let scoreText = '';
        let firstname = 'Moi';
        let lastname = 'Moi';

        if (!anonymous) {
            const fullName = await this.getUserName();
            const names = this.parseName(fullName);
            firstname = names.firstname;
            lastname = names.lastname;
            const today = new Date().toLocaleDateString('fr-FR');

            const currentScore = document.getElementById('score')?.textContent.trim() || '0';
            const totalScore = document.getElementById('total-score')?.textContent.trim() || '10';
            scoreText = `Score : ${currentScore} / ${totalScore}`;

            line1 = `${lastname.toUpperCase()} ${firstname}`;
            line2 = `Date : ${today}`;
        }

        // PAGE 1
        try {
            const bgImg1 = await this.capturePageImage(
                '#page-1-container .page-image',
                '.page-container .page-image'
            );
            this.addFullPageImage(doc, bgImg1);
        } catch (e) {
            console.warn(e.message);
            alert(`Erreur Page 1 : ${e.message}`);
            doc.setFillColor(240, 240, 240);
            doc.rect(0, 0, 420, 297, 'F');
            doc.setFontSize(12);
            doc.setTextColor(200, 0, 0);
            doc.text('Image page 1 non disponible — régénérez le fichier HTML.', 10, 20);
        }

        try {
            await this.addAnnotationsOverlay(doc);
        } catch (err) {
            console.warn('Annotations page 1:', err);
        }
        if (!anonymous) {
            this.addHeaderText(doc, line1, line2, scoreText);
        }

        // PAGE 2
        doc.addPage();

        try {
            const bgImg2 = await this.capturePageImage(
                '#page-2-container .page-image',
                '.page-container:nth-of-type(2) .page-image'
            );
            this.addFullPageImage(doc, bgImg2);
        } catch (e) {
            console.warn(e.message);
            alert(`Erreur Page 2 : ${e.message}`);
            doc.setFillColor(240, 240, 240);
            doc.rect(0, 0, 420, 297, 'F');
            doc.setFontSize(12);
            doc.setTextColor(200, 0, 0);
            doc.text('Image page 2 non disponible — régénérez le fichier HTML.', 10, 20);
        }

        if (!anonymous) {
            this.addHeaderText(doc, line1, line2, scoreText);
        }

        // Téléchargement
        const pdfBlob = doc.output('blob');
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = anonymous ? `${this.filenamePrefix}_synthese.pdf` : `${lastname}_${firstname}_${this.filenamePrefix}.pdf`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const d = document.body ? document.body.dataset : {};
    const exporter = new PDFExporter({
        filenamePrefix: d.pdfPrefix || 'exercice',
    });
    exporter.init();
});
