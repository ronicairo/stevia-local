window.addEventListener('DOMContentLoaded', () => {
    let submitButton = document.querySelector('button[type="submit"]')
    let libelle = document.getElementById('libelle')
    let texte = document.getElementById('texte')

    const checkFields = () => {
        submitButton.disabled = !(libelle.value && texte.value)
        submitButton.style.opacity = submitButton.disabled ? 0.5 : 1
    }

    libelle.addEventListener('change', function () {
        let textNotif = document.querySelector('input.motif-' + this.value)
        if (textNotif) texte.value = textNotif.value
        checkFields()
    })

    texte.addEventListener('input', checkFields)
    checkFields()
})