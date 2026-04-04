window.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll(".can_update_comment").forEach(el => {
        el.addEventListener('click', () => {
            $.ajax({
                url: Routing.generate('demande_saisie_dettes_save_comment'),
                data: {
                    id: document.getElementById('demandeId').value,
                    comment: document.getElementById('demandesaisiedettes_commentaireValidation').value
                },
                type: "POST",
                async: false
            })
        })
    })
})