(function () {
    document.addEventListener('DOMContentLoaded', () => {
        // Injection des styles
        const style = document.createElement('style');
        style.textContent = `
            #btnFullscreen {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                background: rgba(255, 255, 255, 0.9);
                border: 2px solid #333;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                cursor: pointer;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                transition: all 0.3s ease;
            }
            #btnFullscreen:hover {
                transform: scale(1.1);
                background: #fff;
            }
        `;
        document.head.appendChild(style);

        // Création du bouton
        const btn = document.createElement('button');
        btn.id = 'btnFullscreen';
        btn.title = 'Plein écran';
        btn.innerHTML = '⛶'; // Icône plein écran
        document.body.appendChild(btn);

        // Logique de l'API
        function toggleFullscreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.log(`Erreur lors de la tentative d'activation du mode plein écran : ${err.message} (${err.name})`);
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        }

        function updateFullscreenButton() {
            if (document.fullscreenElement) {
                btn.innerHTML = '&#10006;'; // Icône de fermeture
                btn.title = "Quitter plein écran";
            } else {
                btn.innerHTML = '&#9974;'; // Icône plein écran
                btn.title = "Plein écran";
            }
        }

        if (btn) {
            btn.addEventListener('click', toggleFullscreen);
            document.addEventListener('fullscreenchange', updateFullscreenButton);
            // État initial
            updateFullscreenButton();
        }
    });
})();
