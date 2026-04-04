document.addEventListener('DOMContentLoaded', () => {
    $(function () {
        /**
         * champ Code postal
         */
        // https://github.com/RobinHerbots/Inputmask
        $("#adresse_bdf_codePostal").inputmask({
            mask: "#####",
            placeholder: "",
            "oncomplete": function () {
                var cp = $("#adresse_bdf_codePostal").val();
                if (cp.length == 4) {
                    cp = "0" + cp;
                    $("#adresse_bdf_codePostal").val(cp);
                }
            },
            "onincomplete": function () {
                var cp = $("#adresse_bdf_codePostal").val();
                alert("Le code postal " + cp + " est incorrect");
            }
        });
    });
})