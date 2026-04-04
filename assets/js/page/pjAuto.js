window.addEventListener('DOMContentLoaded', function () {
    const uploadFileButton = document.getElementById("uploadFileButton")

    if (uploadFileButton) uploadFileButton.addEventListener('click', () => {
        const zoneUpload = document.getElementById('uploadFichier')
        const generateButton = document.getElementById('generateButton')

        if (zoneUpload.classList.contains('d-none')) {
            zoneUpload.classList.add('d-block')
            generateButton.classList.add('event-none')
            zoneUpload.classList.remove('d-none')
            uploadFileButton.textContent = 'Annuler'
        } else {
            zoneUpload.classList.remove('d-block')
            generateButton.classList.remove('event-none')
            zoneUpload.classList.add('d-none')
            uploadFileButton.textContent = 'Charger le fichier CSV'
        }
    })
})